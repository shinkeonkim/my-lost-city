import { GameConfig } from './config';
import { Card, LogEntry, MatchState, canDrawFrom, matchTotals } from './game';

/** 플레이어(또는 관전자)에게 보내는, 숨김 정보가 제거된 상태 */
export interface GameView {
  config: GameConfig;
  players: number;
  round: number;
  status: MatchState['status'];
  turn: number;
  phase: 'play' | 'draw';
  /** 관전자면 -1 */
  me: number;
  hand: Card[];
  handCounts: number[];
  /** 덱 장수 비공개 설정이면 null */
  deckCount: number | null;
  deckEmpty: boolean;
  expeditions: Card[][][];
  discardTops: (Card | null)[];
  discardCounts: number[];
  /** revealDiscards일 때 아래→위 순서의 전체 더미, 아니면 빈 배열들 */
  discardPiles: Card[][];
  drawable: { deck: boolean; discards: boolean[] };
  roundScores: number[][];
  totals: number[];
  log: LogEntry[];
}

export function viewFor(m: MatchState, me: number): GameView {
  const s = m.state;
  const c = m.config;
  const myTurnDraw = me === s.turn && s.phase === 'draw' && m.status === 'playing';
  return {
    config: c,
    players: m.players,
    round: m.round,
    status: m.status,
    turn: s.turn,
    phase: s.phase,
    me,
    hand: me >= 0 ? s.hands[me] : [],
    handCounts: s.hands.map((h) => h.length),
    deckCount: c.showDeckCount ? s.deck.length : null,
    deckEmpty: s.deck.length === 0,
    expeditions: s.expeditions,
    discardTops: s.discards.map((p) => p[p.length - 1] ?? null),
    discardCounts: s.discards.map((p) => p.length),
    discardPiles: s.discards.map((p) => (c.revealDiscards ? p : [])),
    drawable: {
      deck: myTurnDraw && canDrawFrom(c, s, 'deck'),
      discards: s.discards.map((_, i) => myTurnDraw && canDrawFrom(c, s, i)),
    },
    roundScores: m.roundScores,
    totals: matchTotals(m),
    log: s.log,
  };
}
