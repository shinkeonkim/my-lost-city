import { useEffect, useState } from 'react';
import { call } from './socket';
import { store } from './storage';
import type { Card } from '@el/engine';
import { CardFace } from './cards';
import { Glyph, suitVars } from './theme';
import { GuideButton } from './Guide';

/** 첫 화면 왼쪽: 카드가 탐험대 줄에 차례로 쌓이는 짧은 시연 (반복) */
const DEMO: { col: number; card: Card }[] = [
  { col: 0, card: { id: 'd1', color: 0, value: 0 } as Card },
  { col: 1, card: { id: 'd2', color: 1, value: 3 } as Card },
  { col: 0, card: { id: 'd3', color: 0, value: 4 } as Card },
  { col: 2, card: { id: 'd4', color: 3, value: 2 } as Card },
  { col: 1, card: { id: 'd5', color: 1, value: 6 } as Card },
  { col: 0, card: { id: 'd6', color: 0, value: 7 } as Card },
  { col: 2, card: { id: 'd7', color: 3, value: 5 } as Card },
  { col: 1, card: { id: 'd8', color: 1, value: 9 } as Card },
  { col: 0, card: { id: 'd9', color: 0, value: 10 } as Card },
];

function DemoBoard() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setStep(DEMO.length);
      return;
    }
    const t = setInterval(() => setStep((s) => (s >= DEMO.length + 2 ? 0 : s + 1)), 900);
    return () => clearInterval(t);
  }, []);
  const shown = DEMO.slice(0, Math.min(step, DEMO.length));
  const cols = [0, 1, 2].map((c) => shown.filter((d) => d.col === c).map((d) => d.card));
  const colors = [0, 1, 3];
  return (
    <div className="demo-board" aria-hidden>
      {cols.map((cards, i) => (
        <div key={i} className="demo-col" style={suitVars(colors[i])}>
          <span className="demo-empty">
            <Glyph color={colors[i]} size={18} />
          </span>
          {cards.map((c, j) => (
            <span key={c.id} className="demo-card" style={{ ['--j' as string]: j }}>
              <CardFace card={c} size="sm" />
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

export function Brand({ small }: { small?: boolean }) {
  return (
    <div className={`brand ${small ? 'small' : ''}`}>
      <svg width={small ? 34 : 48} height={small ? 34 : 48} viewBox="0 0 64 64" aria-hidden>
        <rect width="64" height="64" rx="14" fill="var(--ink)" />
        <path d="M14 46 L26 26 L34 36 L42 22 L52 46 Z" fill="var(--sun)" />
        <circle cx="46" cy="16" r="5" fill="var(--paper)" />
      </svg>
      <div>
        <h1>Expedition Lines</h1>
        <p className="muted">탐험대를 꾸려 점수를 모으는 2~4인 카드 게임</p>
      </div>
    </div>
  );
}

/** 첫 화면 공통 틀: 왼쪽 소개 + 오른쪽 카드 (좁으면 위아래) */
export function HomeShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="home">
      <section className="home-hero">
        <Brand />
        <p className="home-lead">
          다섯 지역으로 <b>탐험대</b>를 보내세요. 같은 색 카드를 <b>작은 숫자부터 차례로</b> 쌓을수록 점수가 커집니다.
          <br />
          단, 시작한 탐험대는 비용을 내야 해요 — 어디에 걸지가 승부!
        </p>
        <DemoBoard />
        <ul className="home-chips">
          <li>👥 2~4인 · 4인 팀전</li>
          <li>📱 각자 휴대폰으로 QR 입장</li>
          <li>🧩 색 2~6개·숫자·투자 카드 커스텀</li>
          <li>🃏 끌어다 놓는 카드 · 버림 더미 펼쳐보기</li>
        </ul>
        <GuideButton className="btn guide-cta" label="게임 방법 자세히 보기" />
      </section>
      <section className="home-card panel">{children}</section>
    </main>
  );
}

export function Home({ onEnter, flash }: { onEnter: (code: string) => void; flash: string | null }) {
  const [name, setName] = useState(store.name());
  const [usePw, setUsePw] = useState(false);
  const [password, setPassword] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState<string | null>(flash);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!name.trim()) return setError('닉네임을 입력하세요');
    setBusy(true);
    store.setName(name.trim());
    const pw = usePw ? password : '';
    const r = await call<{ code: string; token: string }>('create', { name, password: pw || undefined });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    store.setToken(r.code, r.token);
    store.setPassword(r.code, pw || null);
    onEnter(r.code);
  };

  const join = () => {
    const c = joinCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(c)) return setError('방 코드는 4자리입니다');
    if (name.trim()) store.setName(name.trim());
    onEnter(c);
  };

  return (
    <HomeShell>
      <h2 className="home-card-title">게임 시작하기</h2>
      <p className="muted small home-step">① 닉네임을 정하고 ② 방을 새로 만들거나, 초대받은 방에 들어가세요</p>
      {error && <div className="alert">{error}</div>}
      <label className="field">
        <span>닉네임</span>
        <div className="name-input">
          <input value={name} maxLength={16} onChange={(e) => setName(e.target.value)} placeholder="예: 민지" />
        </div>
      </label>
      <div className="entry-options">
        <div className="entry create">
          <div className="entry-head">
            <span className="entry-icon" aria-hidden>
              🧭
            </span>
            <div>
              <h3>새 방 만들기</h3>
              <p>내가 방장이 돼요. 만들면 QR·링크로 친구를 초대할 수 있어요.</p>
            </div>
          </div>
          <label className="check small">
            <input type="checkbox" checked={usePw} onChange={(e) => setUsePw(e.target.checked)} /> 방 암호 걸기 (선택)
          </label>
          {usePw && <input value={password} maxLength={64} onChange={(e) => setPassword(e.target.value)} placeholder="암호" onKeyDown={(e) => e.key === 'Enter' && create()} />}
          <button className="btn primary wide big-btn" disabled={busy} onClick={create}>
            방 만들기
          </button>
        </div>
        <div className="entry-or" aria-hidden>
          <span>또는</span>
        </div>
        <div className="entry join">
          <div className="entry-head">
            <span className="entry-icon" aria-hidden>
              🔑
            </span>
            <div>
              <h3>초대받은 방 들어가기</h3>
              <p>친구에게 받은 4자리 방 코드를 입력하세요. QR·링크로 받았다면 그냥 열면 돼요.</p>
            </div>
          </div>
          <div className="row">
            <input
              className="code-input big grow"
              value={joinCode}
              maxLength={4}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && join()}
              placeholder="ABCD"
              autoCapitalize="characters"
              aria-label="방 코드 4자리"
            />
            <button className="btn join-btn big-btn" onClick={join} disabled={joinCode.length !== 4}>
              입장
            </button>
          </div>
        </div>
      </div>
    </HomeShell>
  );
}
