import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { EmoteEvent, GameConfig, LIMITS, PRESETS, RoomView, autoCost } from '@el/engine';
import { store } from './storage';
import { EmoteBubble, EmoteButton, EmoteFeed } from './emotes';
import { Glyph, SUITS, suitVars } from './theme';

type Act = (event: string, payload?: object) => Promise<boolean>;

function useBaseUrl() {
  const [base, setBase] = useState(location.origin);
  useEffect(() => {
    fetch('/api/info')
      .then((r) => r.json())
      .then((info: { publicUrl: string | null; lanHosts: string[] }) => {
        if (info.publicUrl) setBase(info.publicUrl.replace(/\/$/, ''));
        else if (/^(localhost|127\.)/.test(location.hostname) && info.lanHosts[0]) {
          // 로컬 개발: 휴대폰이 접속할 수 있도록 LAN 주소로 바꿈
          setBase(`${location.protocol}//${info.lanHosts[0]}${location.port ? `:${location.port}` : ''}`);
        }
      })
      .catch(() => {});
  }, []);
  return base;
}

export function Lobby({
  view,
  act,
  onLeave,
  emotes,
  onEmote,
}: {
  view: RoomView;
  act: Act;
  onLeave: () => void;
  emotes: EmoteEvent[];
  onEmote: (id: string) => void;
}) {
  const emoteOf = (id: string) => emotes.find((e) => e.from === id);
  const me = view.members.find((m) => m.id === view.you)!;
  const isHost = view.hostId === view.you;
  const players = view.members.filter((m) => m.role === 'player');
  const spectators = view.members.filter((m) => m.role === 'spectator');

  return (
    <main className="page">
      <header className="topbar">
        <div>
          <span className="muted small">방 코드</span>
          <div className="code big">{view.code}</div>
        </div>
        <div className="row tight">
          <EmoteButton onSend={onEmote} />
          {isHost && <CloseRoomButton act={act} />}
          <button className="btn ghost" onClick={onLeave}>
            나가기
          </button>
        </div>
      </header>
      {view.lobby.paused && <PausedNotice view={view} isHost={isHost} />}
      {view.lobby.inResults.length > 0 && (
        <div className="notice">
          🏁 지난 게임이 끝났어요. <b>{view.lobby.inResults.join(', ')}</b> 님이 아직 결과를 보고 있어요 — 로비로 돌아오면 함께 시작할 수 있어요.
        </div>
      )}

      <div className="lobby-grid">
        <ShareBox view={view} isHost={isHost} act={act} />

        <section className="panel">
          <h2>
            플레이어 <span className="muted">{players.length}/4</span>
          </h2>
          <ol className="members">
            {players.map((m, i) => (
              <li key={m.id} className={m.connected ? '' : 'away'}>
                <span className="seat">{i + 1}</span>
                <span className="grow name-cell">
                  <EmoteBubble e={emoteOf(m.id)} />
                  {m.name}
                  {m.isHost && <span className="tag">방장</span>}
                  {m.id === view.you && <span className="tag mine">나</span>}
                  {view.config.teams && players.length === 4 && <span className="tag">{i % 2 === 0 ? 'A팀' : 'B팀'}</span>}
                  {!m.connected && <span className="tag">끊김</span>}
                  {m.connected && m.inResults && <span className="tag results">결과 보는 중</span>}
                  {m.connected && !m.inResults && view.lobby.inResults.length > 0 && <span className="tag ready">대기 중</span>}
                </span>
                {isHost && (
                  <span className="mini-actions">
                    <button className="icon-btn" aria-label="위로" disabled={i === 0} onClick={() => act('reorder', { id: m.id, dir: -1 })}>
                      ↑
                    </button>
                    <button className="icon-btn" aria-label="아래로" disabled={i === players.length - 1} onClick={() => act('reorder', { id: m.id, dir: 1 })}>
                      ↓
                    </button>
                    {m.id !== view.you && (
                      <button className="icon-btn" aria-label="내보내기" onClick={() => act('kick', { id: m.id })}>
                        ✕
                      </button>
                    )}
                  </span>
                )}
              </li>
            ))}
          </ol>
          <EmoteFeed items={emotes.filter((e) => spectators.some((s) => s.id === e.from))} />
          {spectators.length > 0 && (
            <p className="muted small">관전: {spectators.map((m) => m.name).join(', ')}</p>
          )}
          <div className="row">
            {me.role === 'player' ? (
              <button className="btn ghost" onClick={() => act('role', { role: 'spectator' })}>
                관전으로 전환
              </button>
            ) : (
              <button className="btn" disabled={players.length >= 4} onClick={() => act('role', { role: 'player' })}>
                플레이어로 참가
              </button>
            )}
          </div>
          {view.config.teams && <p className="muted small">팀전: 1·3번 좌석이 A팀, 2·4번 좌석이 B팀입니다.</p>}
        </section>

        <ConfigPanel view={view} isHost={isHost} act={act} />
      </div>

      <div className="start-bar">
        <div className="small">
          덱 <b>{view.lobby.deckSize}</b>장 · 1인당 약 <b>{view.lobby.expectedTurns}</b>턴
          {view.lobby.expectedTurns < 12 && view.lobby.errors.length === 0 && <span className="warn"> · 게임이 짧을 수 있어요</span>}
          {view.lobby.errors[0] && <div className="warn">{view.lobby.errors[0]}</div>}
        </div>
        {isHost ? (
          view.lobby.paused ? (
            <div className="row tight">
              <button className="btn" disabled={view.lobby.errors.length > 0} onClick={() => act('start')}>
                새 게임
              </button>
              <button className="btn primary" disabled={!!view.lobby.paused.blocked} onClick={() => act('resume')}>
                이어서 하기
              </button>
            </div>
          ) : view.lobby.inResults.length > 0 ? (
            <div className="row tight">
              <span className="muted small">{view.lobby.inResults.length}명 기다리는 중</span>
              <button className="btn" disabled={view.lobby.errors.length > 0} onClick={() => act('start', { force: true })}>
                기다리지 않고 시작
              </button>
            </div>
          ) : (
            <button className="btn primary" disabled={view.lobby.errors.length > 0} onClick={() => act('start')}>
              게임 시작
            </button>
          )
        ) : (
          <span className="muted small">방장이 시작하길 기다리는 중</span>
        )}
      </div>
    </main>
  );
}

/** 두 번 눌러 확인하는 버튼 (브라우저 confirm 대화상자 대신 인라인 확인) */
function ConfirmButton({ label, warning, onConfirm, small }: { label: string; warning: string; onConfirm: () => void; small?: boolean }) {
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(t);
  }, [confirming]);
  return confirming ? (
    <span className="confirm-close">
      <span className="small">{warning}</span>
      <button className={`btn danger ${small ? 'tiny' : ''}`} onClick={onConfirm}>
        {label}
      </button>
      <button className={`btn ghost ${small ? 'tiny' : ''}`} onClick={() => setConfirming(false)}>
        취소
      </button>
    </span>
  ) : (
    <button className={`btn ghost ${small ? 'tiny' : ''}`} onClick={() => setConfirming(true)}>
      {label}
    </button>
  );
}

/** 방장 전용: 방 닫기 */
export function CloseRoomButton({ act, small }: { act: Act; small?: boolean }) {
  return <ConfirmButton label="방 닫기" warning="모두 나가게 돼요" onConfirm={() => act('close')} small={small} />;
}

/** 방장 전용: 게임 중지 → 모두 로비로 (설정을 바꾼 뒤 이어서 할 수 있음) */
export function StopGameButton({ act, small }: { act: Act; small?: boolean }) {
  return <ConfirmButton label="게임 중지" warning="모두 로비로 가요" onConfirm={() => act('stop')} small={small} />;
}

/** 중지된 게임 안내: 누적 점수와 이어서 하기 방식 */
function PausedNotice({ view, isHost }: { view: RoomView; isHost: boolean }) {
  const p = view.lobby.paused!;
  const done = p.roundOver ? p.round : p.round - 1; // 끝난 판 수
  const changed =
    done === 0
      ? '설정이 바뀌어서 새 설정으로 1판부터 다시 시작해요 (같은 자리 순서).'
      : `설정이 바뀌어서 ${p.roundOver ? '' : '진행 중이던 판은 버리고, '}끝난 ${done}판의 점수를 이어 새 설정으로 ${done + 1}판을 시작해요.`;
  return (
    <div className="notice paused-notice">
      <div>
        ⏸ 방장이 게임을 중지했어요 · <b>{p.round}/{p.rounds}판</b>
        {p.roundOver ? ' 끝난 뒤' : ' 진행 중'} ·{' '}
        {p.players.map((x, i) => (
          <span key={i} className="paused-score">
            {x.name} <b>{x.total}</b>
            {i < p.players.length - 1 ? ', ' : ''}
          </span>
        ))}
      </div>
      <div className="small muted">
        {p.blocked
          ? p.blocked
          : p.sameConfig
            ? '설정이 그대로라 하던 판을 그대로 이어가요. 규칙을 바꾸고 이어서 할 수도 있어요.'
            : changed}
        {isHost ? '' : ' 방장이 이어서 시작하길 기다리는 중이에요.'}
      </div>
    </div>
  );
}

function ShareBox({ view, isHost, act }: { view: RoomView; isHost: boolean; act: Act }) {
  const base = useBaseUrl();
  const savedPw = store.password(view.code);
  const [includePw, setIncludePw] = useState(false);
  const [qr, setQr] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [pwInput, setPwInput] = useState('');
  const [editingPw, setEditingPw] = useState(false);

  const url = `${base}/r/${view.code}${includePw && savedPw && view.hasPassword ? `#pw=${encodeURIComponent(savedPw)}` : ''}`;

  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 320, color: { dark: '#1b1a17', light: '#ffffff' } })
      .then(setQr)
      .catch(() => setQr(''));
  }, [url]);

  const copy = async () => {
    try {
      if (navigator.share && /Mobi/.test(navigator.userAgent)) {
        await navigator.share({ title: 'Expedition Lines', text: `방 ${view.code}에 들어와요`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 취소 */
    }
  };

  const savePw = async () => {
    const pw = pwInput.trim();
    if (await act('password', { password: pw || null })) {
      store.setPassword(view.code, pw || null);
      setEditingPw(false);
      setPwInput('');
    }
  };

  return (
    <section className="panel share">
      <h2>초대하기</h2>
      <div className="qr">{qr ? <img src={qr} alt={`방 ${view.code} 입장 QR 코드`} /> : <div className="qr-ph" />}</div>
      <div className="url-row">
        <code className="url">{url.replace(/^https?:\/\//, '')}</code>
        <button className="btn" onClick={copy}>
          {copied ? '복사됨' : '링크 공유'}
        </button>
      </div>
      <div className="pw-row small">
        {view.hasPassword ? <span>🔒 암호 걸린 방</span> : <span className="muted">암호 없음 — 링크만 있으면 입장</span>}
        {view.hasPassword && savedPw && (
          <label className="check">
            <input type="checkbox" checked={includePw} onChange={(e) => setIncludePw(e.target.checked)} /> QR·링크에 암호 포함
          </label>
        )}
      </div>
      {isHost &&
        (editingPw ? (
          <div className="row">
            <input className="grow" value={pwInput} placeholder="새 암호 (비우면 해제)" maxLength={64} onChange={(e) => setPwInput(e.target.value)} />
            <button className="btn" onClick={savePw}>
              저장
            </button>
          </div>
        ) : (
          <button className="btn ghost small-btn" onClick={() => setEditingPw(true)}>
            암호 {view.hasPassword ? '변경' : '설정'}
          </button>
        ))}
    </section>
  );
}

type NumKey = { [K in keyof GameConfig]: GameConfig[K] extends number ? K : never }[keyof GameConfig];
type BoolKey = { [K in keyof GameConfig]: GameConfig[K] extends boolean ? K : never }[keyof GameConfig];

function ConfigPanel({ view, isHost, act }: { view: RoomView; isHost: boolean; act: Act }) {
  const c = view.config;
  const set = (patch: Partial<GameConfig>) => isHost && act('config', { config: patch });
  const suggested = autoCost(c.minValue, c.maxValue);
  const activePreset = useMemo(() => PRESETS.find((p) => JSON.stringify(p.config) === JSON.stringify(c))?.id, [c]);

  const num = (key: NumKey, label: string, opts: { step?: number; fmt?: (v: number) => string; hint?: string } = {}) => {
    const [lo, hi] = (LIMITS as Record<string, readonly [number, number]>)[key];
    const step = opts.step ?? 1;
    const v = c[key];
    return (
      <div className="cfg-row">
        <div className="grow">
          <div>{label}</div>
          {opts.hint && <div className="muted small">{opts.hint}</div>}
        </div>
        <div className="stepper">
          <button disabled={!isHost || v <= lo} onClick={() => set({ [key]: Math.max(lo, v - step) })} aria-label={`${label} 줄이기`}>
            −
          </button>
          <span>{opts.fmt ? opts.fmt(v) : v}</span>
          <button disabled={!isHost || v >= hi} onClick={() => set({ [key]: Math.min(hi, v + step) })} aria-label={`${label} 늘리기`}>
            +
          </button>
        </div>
      </div>
    );
  };

  const bool = (key: BoolKey, label: string, hint?: string, disabled = false) => (
    <label className={`cfg-row toggle ${disabled ? 'disabled' : ''}`}>
      <div className="grow">
        <div>{label}</div>
        {hint && <div className="muted small">{hint}</div>}
      </div>
      <input type="checkbox" role="switch" checked={c[key]} disabled={!isHost || disabled} onChange={(e) => set({ [key]: e.target.checked })} />
    </label>
  );

  return (
    <section className="panel config">
      <h2>규칙 설정 {!isHost && <span className="muted small">(방장만 변경)</span>}</h2>
      <div className="presets">
        {PRESETS.map((p) => (
          <button key={p.id} className={`chip ${activePreset === p.id ? 'on' : ''}`} disabled={!isHost} onClick={() => set(p.config)} title={p.description}>
            {p.label}
          </button>
        ))}
      </div>

      <div className="suit-strip">
        {Array.from({ length: c.colors }, (_, i) => (
          <span key={i} className="suit-dot" style={suitVars(i)}>
            <Glyph color={i} size={14} /> {SUITS[i].name}
          </span>
        ))}
      </div>

      <h3>카드 구성</h3>
      {num('colors', '탐험대(색) 수', { hint: '원작 5 · 롱게임 6' })}
      {num('minValue', '가장 작은 숫자')}
      {num('maxValue', '가장 큰 숫자')}
      {num('wagersPerColor', '색당 투자 카드')}
      {num('deckCopies', '덱 배수', { fmt: (v) => `${v}벌`, hint: '3~4인용. 2벌 이상이면 같은 숫자 허용을 권장' })}
      {num('handSize', '손패')}

      <h3>점수</h3>
      {num('expeditionCost', '탐험대 비용', { hint: suggested !== c.expeditionCost ? `숫자 범위 기준 권장값 ${suggested}` : '원작 20' })}
      {isHost && suggested !== c.expeditionCost && (
        <button className="btn ghost small-btn" onClick={() => set({ expeditionCost: suggested })}>
          비용을 권장값 {suggested}로 맞추기
        </button>
      )}
      {num('bonusThreshold', '보너스 기준 장수', { fmt: (v) => `${v}장 이상` })}
      {num('bonusPoints', '보너스 점수', { step: 5 })}
      {bool('bonusMultiplied', '보너스에도 투자 배수 적용', '원작은 적용 안 함')}

      <h3>진행</h3>
      {num('rounds', '판 수', { fmt: (v) => `${v}판` })}
      {num('turnTimerSec', '턴 제한시간', { step: 15, fmt: (v) => (v ? `${v}초` : '없음'), hint: '시간이 지나면 자동으로 버리고 덱에서 뽑음' })}
      {bool('allowEqual', '같은 숫자 이어 놓기 허용')}
      {bool('forbidRedrawDiscard', '방금 버린 카드 다시 줍기 금지', '원작 규칙')}
      {bool('showDeckCount', '남은 덱 장수 공개')}
      {bool('revealDiscards', '버림 더미 펼쳐보기', '원작은 맨 위 카드만 보임')}
      {bool('showScorePreview', '현재 점수 미리보기')}
      {bool('teams', '2:2 팀전', '4인일 때만', view.lobby.playerCount !== 4 && !c.teams)}
    </section>
  );
}
