// README용 데모 영상/GIF를 실제 앱을 돌려서 녹화한다.
//
//   npm run build && npm run media            # 모든 클립 → docs/media/
//   npm run media -- play mobile              # 일부 클립만
//
// 로컬에 서버를 띄우고, 봇(Socket.IO 클라이언트)과 헤드리스 크로미움 한 명이 실제로 게임한다.
// 화면은 CDP screencast로 받아 ffmpeg으로 MP4(30fps)와 GIF로 만든다.
// 필요한 것: ffmpeg, Playwright용 크로미움(`npx playwright install chromium`, 또는 PW_CHROMIUM=실행 파일 경로)

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const require = createRequire(new URL('../../apps/server/package.json', import.meta.url));
const { io } = require('socket.io-client');

const ROOT = new URL('../../', import.meta.url).pathname;
const OUT = join(ROOT, 'docs/media');
const PORT = 3299;
const BASE = `http://localhost:${PORT}`;
const FPS = 30;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 공통 도구 ----------

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}

function findChromium() {
  if (process.env.PW_CHROMIUM) return process.env.PW_CHROMIUM;
  const def = chromium.executablePath();
  if (existsSync(def)) return undefined;
  // 설치된 Playwright 버전과 캐시된 브라우저 리비전이 다르면 캐시에서 가장 최신 것을 쓴다
  const cache = join(process.env.HOME ?? '', 'Library/Caches/ms-playwright');
  const revs = existsSync(cache) ? readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1])) : [];
  for (const r of revs) {
    for (const p of [
      'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
      'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
      'chrome-linux/chrome',
    ]) {
      const full = join(cache, r, p);
      if (existsSync(full)) return full;
    }
  }
  return undefined;
}

async function startServer() {
  const srv = spawn('node', ['apps/server/dist/server.cjs'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), MAX_ROOMS: '50', PUBLIC_URL: 'https://my-lost-city.shinkeonkim.com' },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${BASE}/healthz`)).ok) return srv;
    } catch {}
    await sleep(100);
  }
  throw new Error('server did not start — run `npm run build` first');
}

/** 봇 한 명 (또는 브라우저 플레이어와 같은 자리를 쓰는 그림자 소켓) */
class Bot {
  constructor(name) {
    this.name = name;
    this.s = io(BASE, { transports: ['websocket'] });
    this.view = null;
    this.s.on('room', (v) => {
      this.view = v;
      this.tick();
    });
    this.auto = null;
    this.busy = false;
  }
  call(ev, p = {}) {
    return new Promise((r) => this.s.emit(ev, p, r));
  }
  async create(password) {
    const r = await this.call('create', { name: this.name, password });
    this.code = r.code;
    return r;
  }
  join(code, extra = {}) {
    this.code = code;
    return this.call('join', { code, name: this.name, ...extra });
  }
  get g() {
    return this.view?.game;
  }
  get myTurn() {
    const g = this.g;
    return !!g && g.status === 'playing' && g.turn === g.me;
  }
  /** 자동 진행: { delay, playRate, emoteRate, drawDiscardRate } */
  play(opts) {
    this.auto = opts;
    this.tick();
  }
  stop() {
    this.auto = null;
  }
  tick() {
    const g = this.g;
    if (!this.auto || !this.myTurn || this.busy) return;
    this.busy = true;
    const { delay = 900, playRate = 0.7, emoteRate = 0, drawDiscardRate = 0.25, emotes = ['thumbs', 'nice', 'think', 'fire', 'hmm', 'lol'] } = this.auto;
    setTimeout(async () => {
      const move = this.chooseMove(playRate, drawDiscardRate);
      if (Math.random() < emoteRate) this.s.emit('emote', { id: emotes[Math.floor(Math.random() * emotes.length)] }, () => {});
      const r = move ? await this.call('move', { move }) : { ok: true };
      this.busy = false;
      if (!r.ok) console.log(`[${this.name}] ${r.error}`);
      this.tick();
    }, delay);
  }
  chooseMove(playRate = 0.7, drawDiscardRate = 0.25) {
    const g = this.g;
    if (!g || g.turn !== g.me) return null;
    if (g.phase === 'play') {
      const best = this.best();
      if (best && Math.random() < playRate) return { type: 'play', cardId: best.id };
      return { type: 'discard', cardId: this.worst().id };
    }
    const piles = g.drawable.discards.flatMap((ok, i) => (ok ? [i] : []));
    if (piles.length && Math.random() < drawDiscardRate) return { type: 'draw', source: piles[0] };
    return { type: 'draw', source: 'deck' };
  }
  /** 그럴듯한 수: 이미 시작한 탐험대를 작은 간격으로 잇고, 새 탐험대·투자는 같은 색이 손에 많을 때만 */
  best() {
    const g = this.g;
    const same = (c) => g.hand.filter((h) => h.color === c.color && h.id !== c.id && h.value > 0).length;
    let pick = null;
    let score = Infinity;
    for (const c of this.playable()) {
      const col = g.expeditions[g.me][c.color];
      const top = col[col.length - 1];
      let s;
      if (c.value === 0) s = same(c) >= 2 ? 1 : Infinity;
      else if (top) s = c.value - (top.value || this.view.config.minValue - 1);
      else s = same(c) >= 1 ? 3 + c.value : Infinity;
      if (s < score) [pick, score] = [c, s];
    }
    return pick;
  }
  /** 버릴 카드: 이미 못 놓는 카드 → 같은 색이 적은 큰 숫자 */
  worst() {
    const g = this.g;
    const ok = new Set(this.playable().map((c) => c.id));
    const dead = g.hand.filter((c) => !ok.has(c.id));
    const pool = dead.length ? dead : g.hand;
    const count = (c) => g.hand.filter((h) => h.color === c.color).length;
    return [...pool].sort((a, b) => count(a) - count(b) || b.value - a.value)[0];
  }
  playable() {
    const g = this.g;
    const cfg = this.view.config;
    return g.hand.filter((c) => {
      const col = g.expeditions[g.me][c.color];
      const last = col[col.length - 1];
      if (!last) return true;
      if (c.value === 0) return last.value === 0;
      return cfg.allowEqual ? c.value >= last.value : c.value > last.value;
    });
  }
  close() {
    this.s.close();
  }
}

/**
 * 녹화기: 2배 픽셀 스크린샷을 쉬지 않고 찍고(약 15fps), 찍은 시각으로 길이를 복원한다.
 * (CDP screencast는 기기 배율을 무시하고 CSS 픽셀 크기로만 보내 글자가 흐려져서 쓰지 않는다)
 */
async function recorder(page, name, { width, height }) {
  const dir = join(tmpdir(), `el-media-${name}-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const vp = page.viewportSize();
  const scale = width / vp.width;
  const frames = [];
  let running = true;
  const loop = (async () => {
    while (running && !page.isClosed()) {
      const t = Date.now() / 1000;
      try {
        const { data } = await cdp.send('Page.captureScreenshot', {
          format: 'jpeg',
          quality: 92,
          optimizeForSpeed: true,
          clip: { x: 0, y: 0, width: vp.width, height: vp.height, scale },
        });
        const file = join(dir, `${String(frames.length).padStart(5, '0')}.jpg`);
        writeFileSync(file, Buffer.from(data, 'base64'));
        frames.push({ file, t });
      } catch {
        await sleep(30); // 페이지 이동 중
      }
    }
  })();
  const started = Date.now() / 1000;
  return {
    async stop() {
      const end = Date.now() / 1000;
      running = false;
      await loop;
      await cdp.detach();
      if (!frames.length) throw new Error(`no frames for ${name}`);
      // ffconcat: 각 프레임을 다음 프레임 시각까지 유지
      const lines = ['ffconcat version 1.0'];
      frames.forEach((f, i) => {
        const next = frames[i + 1]?.t ?? end;
        const from = i === 0 ? Math.min(f.t, started) : f.t;
        lines.push(`file '${f.file}'`, `duration ${Math.max(0.001, next - from).toFixed(4)}`);
      });
      lines.push(`file '${frames[frames.length - 1].file}'`);
      const list = join(dir, 'list.txt');
      writeFileSync(list, lines.join('\n'));
      const mp4 = join(OUT, 'clips', `${name}.mp4`);
      await run('ffmpeg', [
        '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list,
        '-vf', `fps=${FPS},scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=lanczos`,
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
        mp4,
      ]);
      rmSync(dir, { recursive: true, force: true });
      console.log(`  ${name}: ${(end - started).toFixed(1)}s, ${frames.length} frames → ${mp4}`);
      return mp4;
    },
  };
}

/** 전체 클립을 이어 붙인 소개 영상 + 표지 이미지 */
async function reel() {
  const order = ['intro', 'lobby', 'play', 'discard', 'results', 'mobile'];
  const W = 1920, H = 1200, BG = '0xf3ece1', fade = 0.25;
  const parts = [];
  for (const [i, n] of order.entries()) {
    const d = Number(
      await new Promise((resolve) => {
        const p = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', join(OUT, 'clips', `${n}.mp4`)]);
        let out = '';
        p.stdout.on('data', (b) => (out += b));
        p.on('exit', () => resolve(out.trim()));
      }),
    );
    const fit = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${BG}`;
    const fin = i === 0 ? '' : `,fade=t=in:st=0:d=${fade}:color=${BG}`;
    const fout = i === order.length - 1 ? '' : `,fade=t=out:st=${(d - fade).toFixed(3)}:d=${fade}:color=${BG}`;
    parts.push(`[${i}:v]${fit},setsar=1,fps=${FPS}${fin}${fout}[v${i}]`);
  }
  const inputs = order.flatMap((n) => ['-i', join(OUT, 'clips', `${n}.mp4`)]);
  const concat = `${order.map((_, i) => `[v${i}]`).join('')}concat=n=${order.length}:v=1:a=0[out]`;
  await run('ffmpeg', [
    '-y', '-loglevel', 'error', ...inputs, '-filter_complex', `${parts.join(';')};${concat}`, '-map', '[out]',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '22', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    join(OUT, 'expedition-lines-demo.mp4'),
  ]);
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '3.5', '-i', join(OUT, 'clips', 'discard.mp4'), '-frames:v', '1', '-vf', 'scale=1280:-1', join(OUT, 'cover.png')]);
}

async function gif(name, width, fps = 15, skip = 0) {
  // 글자가 뭉개지지 않게: 256색 팔레트 + sierra 디더 (예전: 128색·bayer·12fps·720px)
  const filters = `fps=${fps},scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=256:stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle`;
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(skip), '-i', join(OUT, 'clips', `${name}.mp4`), '-lavfi', filters, '-loop', '0', join(OUT, 'gif', `${name}.gif`)]);
}

/** 헤드리스에는 마우스 커서가 안 보이므로 가짜 커서와 탭 표시를 그린다 */
const CURSOR_SCRIPT = `
  addEventListener('DOMContentLoaded', () => {
    const touch = matchMedia('(pointer: coarse)').matches;
    const c = document.createElement('div');
    c.id = '__cursor';
    c.style.cssText = 'position:fixed;left:0;top:0;width:22px;height:22px;z-index:2147483647;pointer-events:none;transform:translate(-100px,-100px);transition:opacity .2s;' + (touch ? 'display:none' : '');
    c.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2l16 9.5-7 1.6-3.6 6.9z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.body.appendChild(c);
    const style = document.createElement('style');
    style.textContent = '@keyframes __tap{from{transform:translate(-50%,-50%) scale(.3);opacity:.7}to{transform:translate(-50%,-50%) scale(1.6);opacity:0}}' +
      '.__tap{position:fixed;width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,.55);border:2px solid rgba(30,30,30,.35);pointer-events:none;z-index:2147483646;animation:__tap .45s ease-out forwards}';
    document.head.appendChild(style);
    addEventListener('pointermove', (e) => { c.style.transform = 'translate(' + (e.clientX - 3) + 'px,' + (e.clientY - 2) + 'px)'; }, true);
    addEventListener('pointerdown', (e) => {
      const t = document.createElement('div');
      t.className = '__tap'; t.style.left = e.clientX + 'px'; t.style.top = e.clientY + 'px';
      document.body.appendChild(t); setTimeout(() => t.remove(), 500);
    }, true);
  });
  try { localStorage.setItem('el:mute', '1'); } catch {}
`;

async function center(page, selector) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`not visible: ${selector}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
async function glide(page, selector, steps = 18) {
  const p = await center(page, selector);
  await page.mouse.move(p.x, p.y, { steps });
  return p;
}
async function clickAt(page, selector, pause = 250) {
  await glide(page, selector);
  await sleep(pause);
  await page.mouse.down();
  await sleep(60);
  await page.mouse.up();
}
async function typeSlow(page, text) {
  for (const ch of text) {
    await page.keyboard.type(ch);
    await sleep(110);
  }
}
async function waitFor(fn, timeout = 30_000, label = 'condition') {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await fn()) return;
    await sleep(50);
  }
  throw new Error(`timeout waiting for ${label}`);
}
/** 브라우저 쪽 손패에서 카드의 DOM 순서 */
function handSel(me, card) {
  const i = me.g.hand.findIndex((c) => c.id === card.id);
  return `.hand > .card:nth-child(${i + 1})`;
}
/** 브라우저 플레이어가 화면에서 카드를 끌어 놓는다 */
async function dragCard(page, me, card, target) {
  const from = await center(page, handSel(me, card));
  await page.mouse.move(from.x, from.y, { steps: 14 });
  await sleep(220);
  await page.mouse.down();
  const to = await center(page, `[data-drop="${target}"]`);
  await page.mouse.move(from.x + (to.x - from.x) * 0.15, from.y - 30, { steps: 6 });
  await page.mouse.move(to.x, to.y, { steps: 26 });
  await sleep(220);
  await page.mouse.up();
}
async function myTurnPhase(me, phase) {
  await waitFor(() => me.myTurn && me.g.phase === phase, 60_000, `my ${phase}`);
}

/** 화면 밖에서 빠르게 진행(브라우저 플레이어 몫은 그림자 소켓이 둔다) */
async function fastForward(me, bots, until, playRate = 0.85) {
  for (const b of bots) b.play({ delay: 40, playRate, drawDiscardRate: 0.05 });
  while (!(await until())) {
    if (me.g.status !== 'playing') throw new Error('round ended while fast-forwarding');
    if (me.myTurn) {
      const move = me.chooseMove(playRate, 0.05);
      if (move) await me.call('move', { move });
    }
    await sleep(60);
  }
  for (const b of bots) b.stop();
  await waitFor(() => bots.every((b) => !b.busy), 5000, 'bots idle');
}

// ---------- 클립 ----------

async function desktopFlow(browser, only) {
  const want = (n) => !only.length || only.includes(n);
  if (!['intro', 'lobby', 'play', 'discard', 'results'].some(want)) return;
  const size = { width: 1280, height: 800 };
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 2, locale: 'ko-KR' });
  await ctx.addInitScript(CURSOR_SCRIPT);
  const page = await ctx.newPage();
  const shot = { width: size.width * 2, height: size.height * 2 };
  const bots = [new Bot('도윤'), new Bot('서연')];

  // 0) 첫 화면: 시연 애니메이션 → 게임 방법 모달 훑기
  await page.goto(BASE);
  await page.mouse.move(640, 300);
  await sleep(400);
  if (want('intro')) {
    const intro = await recorder(page, 'intro', shot);
    await sleep(3200);
    await clickAt(page, 'button:has-text("게임 방법 자세히 보기")');
    await sleep(1400);
    for (const id of ['parts', 'turn', 'column', 'score']) {
      await clickAt(page, `.g-nav .chip:nth-child(${['goal', 'parts', 'turn', 'column', 'discard', 'score'].indexOf(id) + 1})`, 150);
      await sleep(1900);
    }
    await page.keyboard.press('Escape');
    await sleep(900);
    await intro.stop();
  }

  // 1) 로비: 방 만들기 → QR → 친구 입장 → 규칙 프리셋
  let rec = want('lobby') ? await recorder(page, 'lobby', shot) : null;
  await sleep(700);
  await clickAt(page, 'input[placeholder="예: 민지"]');
  await typeSlow(page, '민지');
  await sleep(300);
  await clickAt(page, 'button:has-text("방 만들기")');
  await page.waitForSelector('.code.big');
  const code = (await page.textContent('.code.big')).trim();
  await sleep(1200);
  await bots[0].join(code);
  await sleep(500);
  bots[0].s.emit('emote', { id: 'please' }, () => {});
  await sleep(900);
  await bots[1].join(code);
  await sleep(600);
  bots[1].s.emit('emote', { id: 'wow' }, () => {});
  await sleep(700);
  await clickAt(page, '.presets .chip:has-text("롱게임")');
  await sleep(1100);
  await clickAt(page, '[aria-label="탐험대(색) 수 줄이기"]');
  await sleep(700);
  await clickAt(page, '.presets .chip:has-text("3인 권장")');
  await sleep(1200);
  await glide(page, 'button:has-text("게임 시작")');
  await sleep(600);
  if (rec) await rec.stop();

  // 그림자 소켓: 브라우저 플레이어와 같은 자리(토큰)로 붙어 상태를 읽는다
  const token = await page.evaluate((c) => localStorage.getItem(`el:token:${c}`), code);
  const me = new Bot('민지');
  await me.join(code, { token });
  await waitFor(() => me.view, 5000, 'shadow view');

  // 2) 게임: 시작 → 드래그로 내려놓기 → 덱에서 뽑기 → 상대 차례·감정 표현
  rec = want('play') ? await recorder(page, 'play', shot) : null;
  await sleep(300);
  await clickAt(page, 'button:has-text("게임 시작")');
  await waitFor(() => me.g?.status === 'playing', 5000, 'game start');
  for (const b of bots) b.play({ delay: 1000, playRate: 0.8, emoteRate: 0.5, drawDiscardRate: 0.3 });
  await sleep(1500);
  for (let turn = 0; turn < 3; turn++) {
    await myTurnPhase(me, 'play');
    await sleep(turn === 0 ? 900 : 1300);
    const best = me.best();
    if (turn === 1 || !best) {
      const worst = me.worst();
      await dragCard(page, me, worst, `discard-${worst.color}`);
    } else {
      await dragCard(page, me, best, `play-${best.color}`);
    }
    await myTurnPhase(me, 'draw');
    await sleep(700);
    await clickAt(page, '.deck');
    await waitFor(() => !me.myTurn, 5000, 'turn passed');
    if (turn === 1) {
      // 상대 차례 동안 덱 아래 감정 표현
      await sleep(500);
      await clickAt(page, '.deck-col .emote-toggle');
      await sleep(900);
      await clickAt(page, '.emote-phrases .chip:has-text("좋은 수!")');
    }
  }
  await sleep(2500);
  for (const b of bots) b.stop();
  if (rec) await rec.stop();

  // 3) 버림 더미 펼쳐보기: 버림이 쌓일 때까지 빠르게 진행 후 호버
  if (want('discard') || want('results')) {
    await fastForward(me, bots, () => {
      const piles = me.g.discardPiles ?? [];
      const ready = piles.filter((p) => p.length >= 3).length >= 2 || (me.g.deckCount ?? 99) < 16;
      return ready && me.myTurn && me.g.phase === 'play';
    }, 0.5);
    await page.mouse.move(640, 700, { steps: 5 });
    await sleep(1200);
    if (want('discard')) {
      rec = await recorder(page, 'discard', shot);
      await sleep(600);
      const piles = me.g.discardPiles
        .map((p, i) => ({ i, n: p.length }))
        .filter((p) => p.n >= 2)
        .sort((a, b) => b.n - a.n)
        .slice(0, 2);
      for (const p of piles) {
        await glide(page, `[data-drop="discard-${p.i}"]`, 24);
        await sleep(2200);
      }
      // 상대 탐험대 위로도 지나가며 카드 더미 보여주기
      await page.mouse.move(640, 760, { steps: 20 });
      await sleep(900);
      await rec.stop();
    }
  }

  // 4) 판 종료 → 점수표
  if (want('results')) {
    await fastForward(me, bots, () => (me.g.deckCount ?? 99) <= 4 && me.myTurn && me.g.phase === 'play');
    rec = await recorder(page, 'results', shot);
    for (const b of bots) b.play({ delay: 700, playRate: 0.9 });
    while (me.g.status === 'playing') {
      if (me.myTurn && me.g.phase === 'play') {
        await sleep(500);
        const best = me.best();
        const card = best ?? me.worst();
        await dragCard(page, me, card, best ? `play-${card.color}` : `discard-${card.color}`);
        await waitFor(() => me.g.phase === 'draw' || me.g.status !== 'playing', 5000, 'played');
        if (me.g.status !== 'playing') break;
        await sleep(400);
        await clickAt(page, '.deck');
        await waitFor(() => !me.myTurn || me.g.status !== 'playing', 5000, 'drawn');
      }
      await sleep(80);
    }
    await page.waitForSelector('.overlay .scores');
    await sleep(1500);
    await glide(page, '.overlay .scores', 30);
    await sleep(3000);
    await rec.stop();
  }

  for (const b of [...bots, me]) b.close();
  await ctx.close();
}

async function mobileFlow(browser, only) {
  if (only.length && !only.includes('mobile')) return;
  const size = { width: 390, height: 844 };
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR' });
  await ctx.addInitScript(CURSOR_SCRIPT);
  const page = await ctx.newPage();

  // 방장은 봇, 브라우저는 QR 링크로 들어오는 친구
  const host = new Bot('지호');
  await host.create();
  await host.call('config', { config: { colors: 4, handSize: 7 } });
  const code = host.code;

  const rec = await recorder(page, 'mobile', { width: size.width * 2, height: size.height * 2 });
  await page.goto(`${BASE}/r/${code}`);
  await sleep(900);
  await page.tap('.field input');
  await typeSlow(page, '하린');
  await sleep(300);
  await page.tap('button.primary:has-text("입장")');
  await page.waitForSelector('.code.big');
  const token = await page.evaluate((c) => localStorage.getItem(`el:token:${c}`), code);
  const me = new Bot('하린');
  await me.join(code, { token });
  await sleep(1500);
  host.s.emit('emote', { id: 'please' }, () => {});
  await sleep(1300);
  await host.call('start');
  host.play({ delay: 1300, playRate: 0.8, emoteRate: 0.6, emotes: ['hurry', 'thumbs', 'think'] });
  for (let turn = 0; turn < 2; turn++) {
    await myTurnPhase(me, 'play');
    await sleep(1400);
    const best = me.best();
    const card = best ?? me.worst();
    await page.tap(handSel(me, card));
    await sleep(700);
    await page.tap(best ? '.actions button:has-text("탐험대에 놓기")' : '.actions button:has-text("버리기")');
    await myTurnPhase(me, 'draw');
    await sleep(800);
    await page.tap('.deck');
    await waitFor(() => !me.myTurn, 5000, 'turn passed');
  }
  await sleep(2600);
  host.stop();
  await rec.stop();
  for (const b of [host, me]) b.close();
  await ctx.close();
}

// ---------- 실행 ----------

const only = process.argv.slice(2);
mkdirSync(join(OUT, 'clips'), { recursive: true });
mkdirSync(join(OUT, 'gif'), { recursive: true });
const server = await startServer();
const browser = await chromium.launch({ executablePath: findChromium() });
try {
  await desktopFlow(browser, only);
  await mobileFlow(browser, only);
} finally {
  await browser.close();
  server.kill();
}

console.log('GIF 변환…');
// [너비, fps, 앞에서 건너뛸 초] — README에서 GitHub가 그려 주도록 파일마다 약 8MB 이하로
const gifs = { intro: [960, 12], lobby: [960, 15], play: [780, 10, 1.5], discard: [960, 12], results: [820, 10, 3], mobile: [390, 12] };
await Promise.all(
  Object.entries(gifs)
    .filter(([n]) => (!only.length || only.includes(n)) && existsSync(join(OUT, 'clips', `${n}.mp4`)))
    .map(([n, [w, fps, skip = 0]]) => gif(n, w, fps, skip)),
);
if (!only.length) await reel();
// 게임 방법 모달(apps/web/public/guide)에 쓰는 가벼운 영상
const GUIDE = join(ROOT, 'apps/web/public/guide');
mkdirSync(GUIDE, { recursive: true });
for (const n of ['lobby', 'play', 'discard', 'results']) {
  const src = join(OUT, 'clips', `${n}.mp4`);
  if (!existsSync(src) || (only.length && !only.includes(n))) continue;
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-vf', 'scale=960:-2:flags=lanczos', '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', join(GUIDE, `${n}.mp4`)]);
}
writeFileSync(join(OUT, 'README.txt'), '`npm run build && npm run media`로 생성됩니다. 손으로 편집하지 마세요.\n');
console.log('done');
process.exit(0);
