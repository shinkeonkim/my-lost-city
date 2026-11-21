// 무중단 배포 확인: 게임을 진행해 둔 채 배포를 기다렸다가, 재접속 후 같은 게임이 이어지는지 본다.
//
//   node scripts/deploy-check.mjs https://my-lost-city.shinkeonkim.com [기다릴 분, 기본 15]
//
// 봇 두 명이 방을 만들고 몇 수 둔 뒤 연결을 유지한다. 서버가 바뀌어 연결이 끊겼다가 다시 붙으면
// 토큰으로 재입장해 판·로그·손패가 그대로인지 확인하고, 한 수 더 둔 다음 방을 닫는다.

import { createRequire } from 'node:module';

const require = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { io } = require('socket.io-client');

const URL_ = process.argv[2] ?? 'http://localhost:3001';
const WAIT_MIN = Number(process.argv[3] ?? 15);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

function bot(name) {
  const s = io(URL_, { transports: ['websocket'], reconnectionDelayMax: 2000 });
  const b = { s, name, view: null, token: null, code: null };
  s.on('room', (v) => (b.view = v));
  b.call = (ev, p = {}) => new Promise((r) => s.timeout(8000).emit(ev, p, (err, res) => r(err ? { ok: false, error: 'timeout' } : res)));
  return b;
}

async function playOne(bots) {
  const b = bots.find((x) => x.view?.game?.turn === x.view?.game?.me);
  const g = b.view.game;
  const r1 = await b.call('move', { move: { type: 'discard', cardId: g.hand[0].id } });
  const r2 = await b.call('move', { move: { type: 'draw', source: 'deck' } });
  if (!r1.ok || !r2.ok) throw new Error(`move failed: ${r1.error ?? r2.error}`);
  await sleep(300);
}

const a = bot('배포확인A');
const b = bot('배포확인B');
const bots = [a, b];
const made = await a.call('create', { name: a.name });
if (!made.ok) throw new Error(made.error);
a.code = b.code = made.code;
a.token = made.token;
const joined = await b.call('join', { code: made.code, name: b.name });
b.token = joined.token;
await a.call('start');
await sleep(500);
for (let i = 0; i < 3; i++) await playOne(bots);
const before = { round: a.view.game.round, logLen: a.view.game.log.length, hand: JSON.stringify(a.view.game.hand), turn: a.view.game.turn };
log(`방 ${made.code}: 판 ${before.round + 1}, 기록 ${before.logLen}개 — 배포를 기다리는 중 (최대 ${WAIT_MIN}분)`);

const reconnected = new Promise((resolve) => {
  a.s.on('disconnect', (reason) => log(`연결 끊김: ${reason}`));
  a.s.io.on('reconnect', () => resolve());
});
const timeout = sleep(WAIT_MIN * 60_000).then(() => 'timeout');
if ((await Promise.race([reconnected, timeout])) === 'timeout') {
  log('시간 안에 배포가 없었습니다');
  await a.call('close');
  process.exit(2);
}

// 재입장 (실제 클라이언트와 같은 방식: 토큰). 교체 중이면 잠깐 기다렸다 다시
for (const x of bots) {
  for (let i = 0; i < 15; i++) {
    const r = await x.call('join', { code: x.code, name: x.name, token: x.token });
    if (r.ok) break;
    log(`${x.name} 재입장 대기: ${r.error}`);
    await sleep(1000);
  }
}
await sleep(500);
const g = a.view?.game;
const same = g && g.round === before.round && g.log.length === before.logLen && JSON.stringify(g.hand) === before.hand && g.turn === before.turn;
log(same ? '✅ 같은 게임이 그대로 이어짐' : `❌ 상태가 다름: ${JSON.stringify({ before, after: g && { round: g.round, logLen: g.log.length, turn: g.turn } })}`);
if (same) {
  await playOne(bots);
  log(`✅ 새 서버에서 한 수 더 둠 (기록 ${a.view.game.log.length}개)`);
}
await a.call('close');
for (const x of bots) x.s.close();
process.exit(same ? 0 : 1);
