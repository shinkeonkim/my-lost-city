import { GameConfig, deckSize } from './config';

/** value 0 = 와거 카드 */
export interface Card {
  id: string;
  color: number;
  value: number;
}

export type DrawSource = 'deck' | number;

export type Move =
  | { type: 'play'; cardId: string }
  | { type: 'discard'; cardId: string }
  | { type: 'draw'; source: DrawSource };

export interface RoundState {
  deck: Card[];
  hands: Card[][];
  /** [player][color] */
  expeditions: Card[][][];
  /** [color] — 마지막 원소가 맨 위 */
  discards: Card[][];
  turn: number;
  phase: 'play' | 'draw';
  /** 이번 턴에 버린 카드 */
  justDiscarded: string | null;
  finished: boolean;
  /** 최근 행동 기록 (UI 표시용, 최대 LOG_SIZE개) */
  log: LogEntry[];
  moves: number;
}

export interface MatchState {
  config: GameConfig;
  players: number;
  /** 0부터 */
  round: number;
  roundScores: number[][];
  roundStarter: number;
  state: RoundState;
  status: 'playing' | 'round-over' | 'match-over';
}

export type Rng = () => number;

export interface LogEntry {
  /** 이번 판에서 몇 번째 행동인지 (0부터) */
  n: number;
  player: number;
  move: Move;
  /** 덱에서 뽑은 카드는 공개하지 않으므로 없음 */
  card?: Card;
}

const LOG_SIZE = 12;

function pushLog(s: RoundState, e: Omit<LogEntry, 'n'>) {
  s.log.push({ ...e, n: s.moves++ });
  if (s.log.length > LOG_SIZE) s.log.shift();
}

export class MoveError extends Error {}

export function buildDeck(c: GameConfig): Card[] {
  const cards: Card[] = [];
  for (let copy = 0; copy < c.deckCopies; copy++) {
    for (let color = 0; color < c.colors; color++) {
      for (let w = 0; w < c.wagersPerColor; w++) cards.push({ id: `${color}-w${w}-${copy}`, color, value: 0 });
      for (let v = c.minValue; v <= c.maxValue; v++) cards.push({ id: `${color}-${v}-${copy}`, color, value: v });
    }
  }
  if (cards.length !== deckSize(c)) throw new Error('deck size mismatch');
  return cards;
}

export function shuffle<T>(arr: T[], rng: Rng): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function sortHand(hand: Card[]): Card[] {
  return hand.slice().sort((a, b) => a.color - b.color || a.value - b.value || a.id.localeCompare(b.id));
}

export function newRound(c: GameConfig, players: number, starter: number, rng: Rng): RoundState {
  const deck = shuffle(buildDeck(c), rng);
  const hands: Card[][] = [];
  for (let p = 0; p < players; p++) hands.push(sortHand(deck.splice(0, c.handSize)));
  return {
    deck,
    hands,
    expeditions: Array.from({ length: players }, () => Array.from({ length: c.colors }, () => [])),
    discards: Array.from({ length: c.colors }, () => []),
    turn: starter,
    phase: 'play',
    justDiscarded: null,
    finished: false,
    log: [],
    moves: 0,
  };
}

export function newMatch(c: GameConfig, players: number, rng: Rng): MatchState {
  const starter = Math.floor(rng() * players);
  return {
    config: c,
    players,
    round: 0,
    roundScores: [],
    roundStarter: starter,
    state: newRound(c, players, starter, rng),
    status: 'playing',
  };
}

export function canPlayOnExpedition(c: GameConfig, column: Card[], card: Card): boolean {
  const last = column[column.length - 1];
  if (!last) return true;
  if (card.value === 0) return last.value === 0;
  if (last.value === 0) return true;
  return c.allowEqual ? card.value >= last.value : card.value > last.value;
}

export function canDrawFrom(c: GameConfig, s: RoundState, source: DrawSource): boolean {
  if (source === 'deck') return s.deck.length > 0;
  const pile = s.discards[source];
  if (!pile || pile.length === 0) return false;
  if (c.forbidRedrawDiscard && pile[pile.length - 1].id === s.justDiscarded) return false;
  return true;
}

/** 상태를 직접 변경한다. 잘못된 수면 MoveError. */
export function applyMove(m: MatchState, player: number, move: Move): void {
  if (m.status !== 'playing') throw new MoveError('진행 중인 판이 아닙니다');
  const s = m.state;
  const c = m.config;
  if (s.turn !== player) throw new MoveError('내 차례가 아닙니다');

  if (move.type === 'play' || move.type === 'discard') {
    if (s.phase !== 'play') throw new MoveError('지금은 카드를 뽑을 차례입니다');
    const hand = s.hands[player];
    const idx = hand.findIndex((x) => x.id === move.cardId);
    if (idx < 0) throw new MoveError('손에 없는 카드입니다');
    const card = hand[idx];
    if (move.type === 'play') {
      const column = s.expeditions[player][card.color];
      if (!canPlayOnExpedition(c, column, card)) throw new MoveError('그 열에는 이 카드를 놓을 수 없습니다');
      column.push(card);
      s.justDiscarded = null;
    } else {
      s.discards[card.color].push(card);
      s.justDiscarded = card.id;
    }
    hand.splice(idx, 1);
    s.phase = 'draw';
    pushLog(s, { player, move, card });
    return;
  }

  if (move.type === 'draw') {
    if (s.phase !== 'draw') throw new MoveError('먼저 카드를 내야 합니다');
    if (move.source !== 'deck' && (typeof move.source !== 'number' || move.source < 0 || move.source >= c.colors)) {
      throw new MoveError('잘못된 더미입니다');
    }
    if (!canDrawFrom(c, s, move.source)) throw new MoveError('그 더미에서는 뽑을 수 없습니다');
    const card = move.source === 'deck' ? s.deck.shift()! : s.discards[move.source].pop()!;
    s.hands[player] = sortHand([...s.hands[player], card]);
    pushLog(s, { player, move, card: move.source === 'deck' ? undefined : card });
    s.justDiscarded = null;
    s.phase = 'play';
    if (s.deck.length === 0) {
      s.finished = true;
      finishRound(m);
    } else {
      s.turn = (s.turn + 1) % m.players;
    }
    return;
  }

  throw new MoveError('알 수 없는 행동입니다');
}

function finishRound(m: MatchState) {
  m.roundScores.push(m.state.expeditions.map((cols) => scorePlayer(m.config, cols).total));
  m.status = m.round + 1 >= m.config.rounds ? 'match-over' : 'round-over';
}

export function startNextRound(m: MatchState, rng: Rng): void {
  if (m.status !== 'round-over') throw new MoveError('다음 판을 시작할 수 없습니다');
  // 원작: 점수가 가장 높은 사람이 다음 판 선. 동점이면 직전 선 다음 사람부터 찾는다.
  const totals = matchTotals(m);
  const best = Math.max(...totals);
  let starter = 0;
  for (let i = 1; i <= m.players; i++) {
    const p = (m.roundStarter + i) % m.players;
    if (totals[p] === best) {
      starter = p;
      break;
    }
  }
  m.round += 1;
  m.roundStarter = starter;
  m.state = newRound(m.config, m.players, starter, rng);
  m.status = 'playing';
}

export interface ColumnScore {
  cards: number;
  sum: number;
  wagers: number;
  base: number;
  bonus: number;
  total: number;
  started: boolean;
}

export function scoreColumn(c: GameConfig, column: Card[]): ColumnScore {
  if (column.length === 0) return { cards: 0, sum: 0, wagers: 0, base: 0, bonus: 0, total: 0, started: false };
  const wagers = column.filter((x) => x.value === 0).length;
  const sum = column.reduce((a, x) => a + x.value, 0);
  const mult = wagers + 1;
  const base = (sum - c.expeditionCost) * mult;
  const bonus = column.length >= c.bonusThreshold ? c.bonusPoints * (c.bonusMultiplied ? mult : 1) : 0;
  return { cards: column.length, sum, wagers, base, bonus, total: base + bonus, started: true };
}

export function scorePlayer(c: GameConfig, columns: Card[][]) {
  const cols = columns.map((col) => scoreColumn(c, col));
  return { columns: cols, total: cols.reduce((a, x) => a + x.total, 0) };
}

export function matchTotals(m: MatchState): number[] {
  const totals = Array(m.players).fill(0);
  for (const r of m.roundScores) r.forEach((v, i) => (totals[i] += v));
  return totals;
}

export function teamOf(player: number): number {
  return player % 2;
}

/** 시간 초과 시 자동 진행: 가장 덜 아까운 카드를 버리고 덱에서 뽑는다 */
export function autoMove(m: MatchState): Move {
  const s = m.state;
  const p = s.turn;
  if (s.phase === 'draw') return { type: 'draw', source: 'deck' };
  const hand = s.hands[p];
  const cols = s.expeditions[p];
  // 내가 이미 시작하지 않은 색의 카드 중 가장 낮은 숫자를 버림 (와거보다 숫자를 먼저)
  const ranked = hand.slice().sort((a, b) => {
    const sa = cols[a.color].length > 0 ? 1 : 0;
    const sb = cols[b.color].length > 0 ? 1 : 0;
    return sa - sb || (a.value === 0 ? 1 : 0) - (b.value === 0 ? 1 : 0) || a.value - b.value;
  });
  return { type: 'discard', cardId: ranked[0].id };
}
