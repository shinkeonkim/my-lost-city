import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { Card, EmoteEvent, GameView, LogEntry, RoomView, canPlayOnExpedition, playBlockReason, scoreColumn, scorePlayer, teamOf } from '@el/engine';
import { Glyph, SUITS, cardLabel, suitVars } from './theme';
import { CardBack, CardFace } from './cards';
import { hasOrigin, setOrigin } from './flip';
import { CloseRoomButton } from './Lobby';
import { EmoteBubble, EmoteButton, EmoteFeed } from './emotes';
import { sound } from './sound';

type Act = (event: string, payload?: object) => Promise<boolean>;

function useCountdown(deadline: number | null) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!deadline) return;
    const t = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [deadline]);
  // 렌더 시점의 현재 시각으로 계산 (예전 tick 시각을 쓰면 새 턴 직후 1초 더 크게 보임)
  return deadline ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) : null;
}

function describe(e: LogEntry, names: string[]): string {
  const who = names[e.player] ?? `P${e.player + 1}`;
  if (e.move.type === 'play') return `${who} · ${e.card ? cardLabel(e.card) : ''} 놓음`;
  if (e.move.type === 'discard') return `${who} · ${e.card ? cardLabel(e.card) : ''} 버림`;
  return `${who} · ${e.move.source === 'deck' ? '덱에서 뽑음' : `${e.card ? cardLabel(e.card) : ''} 주움`}`;
}

/**
 * 서버 상태가 바뀔 때 "새로 생긴 카드"가 어디서 날아와야 하는지 기록한다.
 * 렌더 중에 호출해야 자식 카드의 layout effect보다 먼저 기록된다.
 */
function useMotionOrigins(g: GameView, refs: { deck: React.RefObject<HTMLElement>; boards: Map<number, HTMLElement> }) {
  const seen = useRef<{ round: number; n: number; hand: Set<string> } | null>(null);
  const lastN = g.log.length ? g.log[g.log.length - 1].n : -1;
  const prev = seen.current;

  if (!prev || prev.round !== g.round) {
    // 새 판 시작(또는 아직 아무도 안 둔 상태로 첫 진입): 덱에서 손패를 나눠주는 연출
    if (lastN < 0 && refs.deck.current) {
      g.hand.forEach((c, i) => setOrigin(c.id, refs.deck.current, { delay: 120 + i * 70, flip: true }));
    }
  } else if (lastN > prev.n) {
    for (const e of g.log) {
      if (e.n <= prev.n || e.player === g.me) continue;
      const board = refs.boards.get(e.player);
      if (e.card && (e.move.type === 'play' || e.move.type === 'discard')) setOrigin(e.card.id, board?.querySelector('.mini-hand') ?? board?.querySelector('.board-head'));
    }
    // 덱에서 뽑은 카드: 덱에서 뒤집히며 손으로 들어옴
    for (const c of g.hand) if (!prev.hand.has(c.id) && !hasOrigin(c.id) && refs.deck.current) setOrigin(c.id, refs.deck.current, { flip: true });
  }
  useEffect(() => {
    seen.current = { round: g.round, n: lastN, hand: new Set(g.hand.map((c) => c.id)) };
  });
}

export function Game({
  view,
  act,
  onLeave,
  notify,
  emotes,
  onEmote,
}: {
  view: RoomView;
  act: Act;
  onLeave: () => void;
  notify: (msg: string) => void;
  emotes: EmoteEvent[];
  onEmote: (id: string) => void;
}) {
  const g = view.game!;
  const c = g.config;
  const range: [number, number] = [c.minValue, c.maxValue];
  const names = view.seats;
  const me = g.me;
  const myTurn = me >= 0 && g.turn === me && g.status === 'playing';
  const [selected, setSelected] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [peek, setPeek] = useState(false);
  useEffect(() => setPeek(false), [g.status, g.round]);
  // 서버가 보낸 "남은 시간"을 받은 순간 기준으로 마감 시각 계산 (기기 시계 오차 무관)
  const turnDeadline = useMemo(() => (view.turnRemainingMs !== null ? Date.now() + view.turnRemainingMs : null), [view]);
  const nudgeDeadline = useMemo(() => (view.nudgeInMs !== null ? Date.now() + view.nudgeInMs : null), [view]);
  const secs = useCountdown(turnDeadline);
  const nudgeLeft = useCountdown(nudgeDeadline);
  const [shake, setShake] = useState(0);
  const turnName = names[g.turn] ?? '';
  const warn = (msg: string) => {
    notify(msg);
    setShake((n) => n + 1);
  };
  const notMyTurnMsg = me < 0 ? '관전 중에는 플레이할 수 없어요' : `지금은 ${turnName} 님의 차례예요`;

  // 내 차례가 오면 진동 + (다른 탭을 보고 있으면) 탭 제목으로 알림
  useEffect(() => {
    if (!myTurn) return;
    try {
      navigator.vibrate?.(60);
    } catch {
      /* 지원 안 함 */
    }
    if (document.hidden) document.title = '● 내 차례 — Expedition Lines';
    const restore = () => {
      if (!document.hidden) document.title = 'Expedition Lines';
    };
    document.addEventListener('visibilitychange', restore);
    return () => {
      document.removeEventListener('visibilitychange', restore);
      document.title = 'Expedition Lines';
    };
  }, [myTurn]);

  // 턴이 바뀔 때 화면 가운데 스플래시 + 알림음
  const [splash, setSplash] = useState<{ text: string; sub: string; mine: boolean; k: number } | null>(null);
  const turnKey = `${g.round}-${g.turn}-${g.status}`;
  const firstTurnKey = useRef(turnKey);
  useEffect(() => {
    if (turnKey === firstTurnKey.current || g.status !== 'playing') return;
    const mine = g.turn === me;
    setSplash({
      text: mine ? '내 차례!' : `${turnName} 님 차례`,
      sub: mine ? '카드를 1장 내려놓고, 1장 가져오세요' : (g.turn + 1) % g.players === me ? '다음은 내 차례예요' : '',
      mine,
      k: Date.now(),
    });
    sound.play(mine ? 'myTurn' : 'turn');
    const t = setTimeout(() => setSplash(null), mine ? 1500 : 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnKey]);
  const [muted, setMuted] = useState(sound.muted);
  useEffect(() => {
    const off = sound.subscribe(setMuted);
    return () => {
      off();
    };
  }, []);
  const emoteBySeat = new Map<number, EmoteEvent>();
  for (const e of emotes) if (e.seat !== null) emoteBySeat.set(e.seat, e);
  const seatless = emotes.filter((e) => e.seat === null);

  const deckRef = useRef<HTMLDivElement>(null);
  const boards = useRef(new Map<number, HTMLElement>()).current;
  const piles = useRef(new Map<number, HTMLElement>()).current;
  const handEls = useRef(new Map<string, HTMLElement>()).current;
  useMotionOrigins(g, { deck: deckRef, boards });

  const selCard = g.hand.find((x) => x.id === selected) ?? null;
  useEffect(() => {
    if (!myTurn || g.phase !== 'play') setSelected(null);
  }, [myTurn, g.phase]);

  const canPlaySel = !!selCard && myTurn && g.phase === 'play' && canPlayOnExpedition(c, g.expeditions[me][selCard.color], selCard);

  const playable = useMemo(
    () => new Set(me >= 0 ? g.hand.filter((h) => canPlayOnExpedition(c, g.expeditions[me][h.color], h)).map((h) => h.id) : []),
    [g.hand, g.expeditions, me, c],
  );

  const canPlay = (card: Card) => myTurn && g.phase === 'play' && canPlayOnExpedition(c, g.expeditions[me][card.color], card);
  const play = async (card = selCard, from?: Element | null) => {
    if (!card || !canPlay(card)) return;
    setOrigin(card.id, from ?? handEls.get(card.id));
    if (await act('move', { move: { type: 'play', cardId: card.id } })) setSelected(null);
  };
  const discard = async (card = selCard, from?: Element | null) => {
    if (!card) return;
    setOrigin(card.id, from ?? handEls.get(card.id));
    if (await act('move', { move: { type: 'discard', cardId: card.id } })) setSelected(null);
  };

  // ---- 드래그로 내려놓기 (마우스·터치 공통, pointer events) ----
  const [drag, setDrag] = useState<{ card: Card; x: number; y: number; w: number; over: string | null } | null>(null);
  const suppressClick = useRef(0);
  const dropAt = (x: number, y: number, card: Card): string | null => {
    const el = document.elementFromPoint(x, y)?.closest('[data-drop]');
    const key = el?.getAttribute('data-drop') ?? null;
    if (!key) return null;
    const [kind, col] = key.split('-');
    if (Number(col) !== card.color) return null;
    if (kind === 'play' && !canPlay(card)) return null;
    return key;
  };
  const startDrag = (e: React.PointerEvent<HTMLElement>, card: Card) => {
    if (!myTurn || g.phase !== 'play' || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY };
    const off = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    let dragging = false;
    const move = (ev: PointerEvent) => {
      if (!dragging) {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 8) return;
        dragging = true;
        setSelected(card.id);
      }
      ev.preventDefault();
      setDrag({ card, x: ev.clientX - off.x, y: ev.clientY - off.y, w: rect.width, over: dropAt(ev.clientX, ev.clientY, card) });
    };
    const end = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      if (!dragging) return;
      suppressClick.current = Date.now();
      const target = ev.type === 'pointerup' ? dropAt(ev.clientX, ev.clientY, card) : null;
      const ghost = document.querySelector('.drag-ghost .card');
      if (target?.startsWith('play')) play(card, ghost);
      else if (target?.startsWith('discard')) discard(card, ghost);
      setDrag(null);
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };
  const draw = (source: 'deck' | number) => {
    if (source !== 'deck') {
      const top = g.discardTops[source];
      if (top) setOrigin(top.id, piles.get(source)?.querySelector('.in-pile:last-child'));
    }
    return act('move', { move: { type: 'draw', source } });
  };

  // 다른 플레이어: 내 다음 순서부터
  const others: number[] = [];
  for (let i = 1; i <= g.players; i++) {
    const p = me >= 0 ? (me + i) % g.players : i - 1;
    if (p !== me) others.push(p);
  }

  const turnMember = view.members.find((m) => m.seat === g.turn);
  const awaySeats = new Set(view.members.filter((m) => m.seat !== null && !m.connected).map((m) => m.seat!));
  const lastEntry = g.log[g.log.length - 1];
  const iJustDiscarded =
    myTurn && g.phase === 'draw' && lastEntry && lastEntry.player === me && lastEntry.move.type === 'discard' && lastEntry.card ? lastEntry.card : null;

  const onHandClick = (card: Card) => {
    if (Date.now() - suppressClick.current < 300) return;
    if (g.status !== 'playing') return;
    if (!myTurn) return warn(notMyTurnMsg);
    if (g.phase === 'draw') return warn('먼저 카드를 1장 가져오세요 — 덱이나 빛나는 버림 더미를 누르세요');
    setSelected((s) => (s === card.id ? null : card.id));
  };
  const onDeckClick = () => {
    if (g.drawable.deck) return draw('deck');
    if (g.status !== 'playing') return;
    if (!myTurn) return warn(notMyTurnMsg);
    if (g.phase === 'play') return warn('먼저 카드를 1장 내려놓으세요');
  };
  /** 버림 더미를 눌렀는데 놓기/가져오기가 아닐 때 이유 안내 */
  const onPileIdle = (color: number) => {
    if (!myTurn) return;
    if (g.phase === 'draw' && iJustDiscarded?.color === color) return warn('방금 버린 카드는 바로 다시 가져올 수 없어요');
    if (g.phase === 'play' && selCard && selCard.color !== color) return warn('같은 색 버림 더미에만 버릴 수 있어요');
  };
  const onColumnClick = (col: number) => {
    if (!myTurn || g.phase !== 'play' || !selCard) return;
    if (col !== selCard.color) return warn('같은 색 탐험대에만 놓을 수 있어요');
    const reason = playBlockReason(c, g.expeditions[me][col], selCard);
    if (reason) return warn(`${reason} (버리기는 가능해요)`);
    play();
  };

  const last = g.log[g.log.length - 1];
  const freshId = last && last.card && last.move.type !== 'draw' ? last.card.id : null;
  const isTeam = c.teams && g.players === 4;

  return (
    <main className={`page game ${myTurn ? 'my-turn' : ''}`} style={{ ['--cols' as string]: c.colors }}>
      <header className="topbar compact">
        <div className="small">
          <b>
            {g.round + 1}/{c.rounds}판
          </b>
          <span className="muted"> · {view.code}</span>
        </div>
        <div className="small right">
          <button className="btn ghost tiny" aria-label={muted ? '소리 켜기' : '소리 끄기'} onClick={() => sound.setMuted(!muted)}>
            {muted ? '🔕' : '🔔'}
          </button>
          {view.hostId === view.you && <CloseRoomButton act={act} small />}
          <button className="btn ghost tiny" onClick={() => setShowLog((v) => !v)}>
            기록
          </button>
        </div>
      </header>

      {g.status === 'playing' && (
        <TurnBanner
          g={g}
          myTurn={myTurn}
          turnName={turnName}
          away={!!turnMember && !turnMember.connected}
          secs={secs}
          nudgeLeft={view.nudgeInMs !== null ? nudgeLeft : null}
          onNudge={() => act('nudge')}
          selCard={selCard}
          justDiscarded={iJustDiscarded}
          shake={shake}
        />
      )}

      {showLog && (
        <div className="log panel">
          {g.log.length === 0 ? <span className="muted small">아직 기록이 없습니다</span> : g.log.map((e) => <div key={e.n} className="small">{describe(e, names)}</div>)}
        </div>
      )}

      <section className="opponents">
        {others.map((p) => (
          <PlayerBoard
            key={p}
            ref={(el) => {
              if (el) boards.set(p, el);
              else boards.delete(p);
            }}
            view={g}
            seat={p}
            name={names[p]}
            active={g.turn === p}
            compact
            emote={emoteBySeat.get(p)}
            away={awaySeats.has(p)}
            team={isTeam ? teamOf(p) : null}
            freshId={freshId}
          />
        ))}
      </section>

      <section className="table">
        <div className="piles">
          {g.discardTops.map((top, color) => (
            <Pile
              key={color}
              ref={(el) => {
                if (el) piles.set(color, el);
                else piles.delete(color);
              }}
              color={color}
              cards={c.revealDiscards ? g.discardPiles[color] : top ? [top] : []}
              count={g.discardCounts[color]}
              range={range}
              reveal={c.revealDiscards}
              target={!!selCard && selCard.color === color && myTurn && g.phase === 'play'}
              drawable={g.drawable.discards[color]}
              freshId={freshId}
              onDiscard={() => discard()}
              dragOver={drag?.over === `discard-${color}`}
              onDraw={() => draw(color)}
              onIdle={() => onPileIdle(color)}
            />
          ))}
        </div>
        <div className="deck-col">
          <button className={`deck ${g.drawable.deck ? 'drawable' : ''}`} onClick={onDeckClick} aria-label={`덱에서 뽑기 (${g.deckCount ?? '?'}장)`}>
            {(g.deckCount ?? 10) > 2 && <CardBack className="layer l2" />}
            {(g.deckCount ?? 10) > 1 && <CardBack className="layer l1" />}
            {!g.deckEmpty && <CardBack ref={deckRef} className="layer l0" />}
            <span className="deck-count">{g.deckCount ?? '?'}</span>
          </button>
          {/* 감정 표현: 덱 바로 아래 */}
          <EmoteButton onSend={onEmote} small />
        </div>
      </section>

      <div className="ticker small muted" aria-live="polite" key={last?.n ?? -1}>
        {last ? describe(last, names) : ' '}
      </div>

      {me >= 0 && (
        <>
          <PlayerBoard
            ref={(el) => {
              if (el) boards.set(me, el);
              else boards.delete(me);
            }}
            view={g}
            seat={me}
            name={`${names[me]} (나)`}
            active={myTurn}
            team={isTeam ? teamOf(me) : null}
            highlightColor={canPlaySel ? selCard!.color : null}
            emote={emoteBySeat.get(me)}
            onColumnClick={onColumnClick}
            dropTargets
            dragOver={drag?.over ?? null}
            freshId={freshId}
          />

          <section className="hand-area">
            <div className="actions">
              {myTurn && g.phase === 'play' && selCard ? (
                <>
                  <button className="btn primary" disabled={!canPlaySel} onClick={() => play()}>
                    탐험대에 놓기
                  </button>
                  <button className="btn" onClick={() => discard()}>
                    버리기
                  </button>
                </>
              ) : (
                <span className="muted small">
                  {myTurn ? (g.phase === 'play' ? '카드를 누르거나, 끌어서 탐험대·버림 더미에 놓으세요' : '덱이나 빛나는 버림 더미를 누르세요') : ' '}
                </span>
              )}
            </div>
            <div className="hand" style={{ ['--n' as string]: Math.max(g.hand.length, 1) }}>
              {g.hand.map((card, i) => (
                <CardFace
                  key={card.id}
                  ref={(el) => {
                    if (el) handEls.set(card.id, el);
                    else handEls.delete(card.id);
                  }}
                  card={card}
                  range={range}
                  style={{ ['--i' as string]: i - (g.hand.length - 1) / 2 }}
                  selected={card.id === selected}
                  dim={myTurn && g.phase === 'play' && !playable.has(card.id)}
                  className={drag?.card.id === card.id ? 'dragging' : ''}
                  onPointerDown={(e) => startDrag(e, card)}
                  onClick={() => onHandClick(card)}
                />
              ))}
            </div>
          </section>
        </>
      )}

      {me < 0 && <p className="muted small center-text">관전 중입니다</p>}

      <EmoteFeed items={seatless} />
      {splash && (
        <div className={`turn-splash ${splash.mine ? 'mine' : ''}`} key={splash.k} aria-hidden>
          <div className="ts-text">{splash.text}</div>
          {splash.sub && <div className="ts-sub">{splash.sub}</div>}
        </div>
      )}

      {drag && (
        <div className={`drag-ghost ${drag.over ? 'on-target' : ''}`} style={{ left: drag.x, top: drag.y, ['--gw' as string]: `${drag.w}px` }} aria-hidden>
          <CardFace card={drag.card} range={range} />
        </div>
      )}

      {g.status !== 'playing' &&
        (peek ? (
          <button className="btn primary peek-btn" onClick={() => setPeek(false)}>
            점수 보기
          </button>
        ) : (
          <RoundOver view={view} act={act} onLeave={onLeave} onPeek={() => setPeek(true)} />
        ))}
    </main>
  );
}

/** 화면 위쪽 차례 안내: 누구 차례인지, 지금 할 일(① 내려놓기 → ② 가져오기), 남은 시간 */
function TurnBanner({
  g,
  myTurn,
  turnName,
  away,
  secs,
  nudgeLeft,
  onNudge,
  selCard,
  justDiscarded,
  shake,
}: {
  g: GameView;
  myTurn: boolean;
  turnName: string;
  away: boolean;
  secs: number | null;
  nudgeLeft: number | null;
  onNudge: () => void;
  selCard: Card | null;
  justDiscarded: Card | null;
  shake: number;
}) {
  const c = g.config;
  let title: string;
  let hint: string;
  if (myTurn && g.phase === 'play') {
    title = '내 차례예요 · 카드를 1장 내려놓으세요';
    if (selCard) {
      const reason = playBlockReason(c, g.expeditions[g.me][selCard.color], selCard);
      hint = reason ? `${cardLabel(selCard)}: ${reason} — 버림 더미에 버릴 수는 있어요` : `${cardLabel(selCard)}: 내 탐험대에 놓거나, 같은 색 버림 더미에 버리세요`;
    } else hint = '내 탐험대에 놓거나 같은 색 버림 더미에 버리세요';
  } else if (myTurn) {
    title = '이제 카드를 1장 가져오세요';
    hint = justDiscarded ? `덱이나 빛나는 버림 더미에서 — 방금 버린 ${cardLabel(justDiscarded)}는 다시 못 가져와요` : '덱이나 빛나는 버림 더미를 누르세요';
  } else {
    title = `${turnName} 님의 차례예요`;
    hint = away ? '연결이 끊겼어요 · 다시 들어오길 기다리는 중' : g.phase === 'play' ? '카드를 내려놓는 중…' : '카드를 가져가는 중…';
    if (g.me >= 0 && (g.turn + 1) % g.players === g.me) hint += ' · 다음은 내 차례예요'
    if (g.me < 0) hint += ' · 관전 중';
  }
  const deckLow = g.deckCount !== null && g.deckCount > 0 && g.deckCount <= g.players * 2;
  return (
    <section className={`turn-banner ${myTurn ? 'mine' : 'theirs'} ${away ? 'away' : ''}`} aria-live="polite">
      <div className={`tb-body ${shake ? 'shake' : ''}`} key={`${shake}-${g.turn}-${g.phase}`}>
        <div className="tb-text">
          <div className="tb-title">{title}</div>
          <div className="tb-hint">{hint}</div>
        </div>
        <div className="tb-side">
          {myTurn && (
            <ol className="tb-steps" aria-label="이번 차례 단계">
              <li className={g.phase === 'play' ? 'on' : 'done'}>① 내려놓기</li>
              <li className={g.phase === 'draw' ? 'on' : ''}>② 가져오기</li>
            </ol>
          )}
          {secs !== null && <span className={`tb-timer ${secs <= 10 ? 'hot' : ''}`}>{secs}초</span>}
          {away && nudgeLeft !== null && g.me >= 0 && (
            <button className="btn tiny" disabled={nudgeLeft > 0} onClick={onNudge} title="자동으로 카드 1장을 버리고 덱에서 1장 가져옵니다">
              대신 진행{nudgeLeft > 0 ? ` (${nudgeLeft}초)` : ''}
            </button>
          )}
        </div>
      </div>
      {deckLow && <div className="tb-deck-low">덱 {g.deckCount}장 남음 · 덱이 바닥나면 판이 끝나요</div>}
    </section>
  );
}

/** 버림 더미 — 마우스를 올리거나 장수 배지를 누르면 쌓인 카드가 위로 스르륵 펼쳐진다 */
const Pile = forwardRef<
  HTMLDivElement,
  {
    color: number;
    cards: Card[];
    count: number;
    range: [number, number];
    reveal: boolean;
    target: boolean;
    drawable: boolean;
    freshId: string | null;
    dragOver: boolean;
    onDiscard: () => void;
    onDraw: () => void;
    onIdle: () => void;
  }
>(function Pile({ color, cards, count, range, reveal, target, drawable, freshId, dragOver, onDiscard, onDraw, onIdle }, ref) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  const canPeek = reveal && count > 1;
  const n = cards.length;
  return (
    <div
      ref={(el) => {
        wrap.current = el;
        if (typeof ref === 'function') ref(el);
        else if (ref) ref.current = el;
      }}
      className={`pile ${open ? 'open' : ''} ${target ? 'target' : ''} ${drawable ? 'drawable' : ''} ${dragOver ? 'drag-over' : ''}`}
      data-drop={`discard-${color}`}
      style={{ ...suitVars(color), ['--n' as string]: n }}
      onPointerEnter={(e) => e.pointerType === 'mouse' && canPeek && setOpen(true)}
      onPointerLeave={(e) => e.pointerType === 'mouse' && setOpen(false)}
    >
      <button
        className="pile-hit"
        onClick={() => {
          if (target) return onDiscard();
          if (drawable) return onDraw();
          onIdle();
          if (canPeek) setOpen((v) => !v);
        }}
        aria-label={`${SUITS[color].name} 버림 더미 ${count}장${drawable ? ', 눌러서 가져오기' : ''}${target ? ', 눌러서 버리기' : ''}`}
      >
        <span className="pile-stack">
          <span className="pile-empty">
            <Glyph color={color} size={18} />
          </span>
          {cards.map((card, i) => (
            <CardFace
              key={card.id}
              card={card}
              size="sm"
              range={range}
              className="in-pile"
              fresh={card.id === freshId}
              style={{ ['--depth' as string]: n - 1 - i, zIndex: i + 1 }}
            />
          ))}
        </span>
      </button>
      {count > 1 && (
        <button className="count" onClick={() => canPeek && setOpen((v) => !v)} aria-label={`${SUITS[color].name} 버림 더미 펼치기`} aria-expanded={open}>
          {count}
        </button>
      )}
    </div>
  );
});

const PlayerBoard = forwardRef<
  HTMLDivElement,
  {
    view: GameView;
    seat: number;
    name: string;
    active: boolean;
    compact?: boolean;
    team: number | null;
    highlightColor?: number | null;
    onColumnClick?: (color: number) => void;
    freshId: string | null;
    dropTargets?: boolean;
    dragOver?: string | null;
    away?: boolean;
    emote?: EmoteEvent;
  }
>(function PlayerBoard({ view, seat, name, active, compact, team, highlightColor, onColumnClick, freshId, dropTargets, dragOver, away, emote }, ref) {
  const c = view.config;
  const cols = view.expeditions[seat];
  const score = scorePlayer(c, cols);
  return (
    <div ref={ref} className={`board ${compact ? 'compact' : ''} ${active ? 'active' : ''}`}>
      <div className="board-head small">
        <span className="name">
          <EmoteBubble e={emote} />
          {active && <span className="pulse" aria-hidden />}
          {name}
          {team !== null && <span className="tag">{team === 0 ? 'A팀' : 'B팀'}</span>}
          {away && <span className="tag away-tag">연결 끊김</span>}
        </span>
        <span className="muted head-right">
          <span className="mini-hand" title={`손패 ${view.handCounts[seat]}장`} aria-label={`손패 ${view.handCounts[seat]}장`}>
            {Array.from({ length: Math.min(view.handCounts[seat], 10) }, (_, i) => (
              <i key={i} />
            ))}
          </span>
          {c.showScorePreview && (
            <span>
              <b className={score.total < 0 ? 'neg' : ''}>{score.total}</b>점
            </span>
          )}
        </span>
      </div>
      <div className="columns">
        {cols.map((col, color) => {
          const s = scoreColumn(c, col);
          return (
            <div
              key={color}
              className={`column ${highlightColor === color ? 'target' : ''} ${col.length ? 'has' : ''} ${dragOver === `play-${color}` ? 'drag-over' : ''}`}
              data-drop={dropTargets ? `play-${color}` : undefined}
              style={{ ...suitVars(color), ['--n' as string]: col.length }}
              onClick={onColumnClick ? () => onColumnClick(color) : undefined}
            >
              {col.length === 0 && (
                <span className="col-empty">
                  <Glyph color={color} size={compact ? 12 : 16} />
                </span>
              )}
              <div className="stack">
                {col.map((card) => (
                  <CardFace key={card.id} card={card} size={compact ? 'xs' : 'sm'} range={[c.minValue, c.maxValue]} fresh={card.id === freshId} />
                ))}
              </div>
              {c.showScorePreview && s.started && (
                <span className={`col-score ${s.total < 0 ? 'neg' : ''}`}>
                  {s.total > 0 ? `+${s.total}` : s.total}
                  {s.wagers > 0 && <small> ×{s.wagers + 1}</small>}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});

function RoundOver({ view, act, onLeave, onPeek }: { view: RoomView; act: Act; onLeave: () => void; onPeek: () => void }) {
  const g = view.game!;
  const c = g.config;
  const names = view.seats;
  const isTeam = c.teams && g.players === 4;
  const matchOver = g.status === 'match-over';
  const order = Array.from({ length: g.players }, (_, i) => i).sort((a, b) => g.totals[b] - g.totals[a]);
  const teamTotals = [0, 0];
  if (isTeam) g.totals.forEach((t, i) => (teamTotals[teamOf(i)] += t));

  let headline = '';
  if (matchOver) {
    if (isTeam) headline = teamTotals[0] === teamTotals[1] ? '무승부!' : `${teamTotals[0] > teamTotals[1] ? 'A팀' : 'B팀'} 승리!`;
    else {
      const best = g.totals[order[0]];
      const winners = order.filter((p) => g.totals[p] === best).map((p) => names[p]);
      headline = `${winners.join(', ')} 승리!`;
    }
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="점수">
      <div className="panel sheet">
        <h2>{matchOver ? headline : `${g.round + 1}판 결과`}</h2>
        <div className="table-wrap">
          <table className="scores">
            <thead>
              <tr>
                <th />
                {Array.from({ length: c.colors }, (_, i) => (
                  <th key={i} style={suitVars(i)} className="suit-th">
                    <Glyph color={i} size={12} />
                  </th>
                ))}
                <th>이번 판</th>
                <th>합계</th>
              </tr>
            </thead>
            <tbody>
              {order.map((p, rank) => {
                const s = scorePlayer(c, g.expeditions[p]);
                return (
                  <tr key={p} style={{ ['--r' as string]: rank }}>
                    <th className="left">
                      {names[p]}
                      {isTeam && <span className="tag">{teamOf(p) === 0 ? 'A' : 'B'}</span>}
                    </th>
                    {s.columns.map((col, i) => (
                      <td key={i} className={col.total < 0 ? 'neg' : col.started ? '' : 'muted'} title={col.started ? `합 ${col.sum}, 투자 ${col.wagers}, 보너스 ${col.bonus}` : ''}>
                        {col.started ? col.total : '·'}
                      </td>
                    ))}
                    <td className={s.total < 0 ? 'neg' : ''}>{s.total}</td>
                    <td>
                      <b>{g.totals[p]}</b>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {isTeam && (
          <p>
            A팀 <b>{teamTotals[0]}</b> : <b>{teamTotals[1]}</b> B팀
          </p>
        )}
        {g.roundScores.length > 1 && (
          <p className="muted small">
            판별:{' '}
            {g.roundScores.map((r, i) => (
              <span key={i}>
                {i + 1}판({r.join(' / ')}){' '}
              </span>
            ))}
          </p>
        )}
        <div className="row">
          <button className="btn primary grow" onClick={() => (matchOver ? act('back') : act('next', { round: g.round, status: g.status }))}>
            {matchOver ? '로비로 돌아가기' : '다음 판 시작'}
          </button>
          <button className="btn" onClick={onPeek}>
            보드 보기
          </button>
          {matchOver && (
            <button className="btn ghost" onClick={onLeave}>
              나가기
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
