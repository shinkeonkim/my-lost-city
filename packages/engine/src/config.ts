export interface GameConfig {
  /** 색(탐험대) 수, 2~6 */
  colors: number;
  minValue: number;
  maxValue: number;
  /** 색당 와거(투자) 카드 장수 */
  wagersPerColor: number;
  /** 같은 카드 세트를 몇 벌 섞을지 */
  deckCopies: number;
  handSize: number;
  /** 탐험대 비용 (원작 20) */
  expeditionCost: number;
  /** 이 장수 이상이면 보너스 (원작 8) */
  bonusThreshold: number;
  bonusPoints: number;
  /** 보너스에도 와거 배수를 적용할지 (원작: 적용 안 함) */
  bonusMultiplied: boolean;
  /** 같은 숫자를 이어 놓을 수 있는지 */
  allowEqual: boolean;
  /** 이번 턴에 버린 카드를 바로 다시 가져오지 못함 (원작 규칙) */
  forbidRedrawDiscard: boolean;
  rounds: number;
  /** 0 = 제한 없음 */
  turnTimerSec: number;
  showDeckCount: boolean;
  showScorePreview: boolean;
  /** 버림 더미 전체를 펼쳐볼 수 있음 (원작: 맨 위만 보임) */
  revealDiscards: boolean;
  /** 4인 팀전 (좌석 0·2 vs 1·3) */
  teams: boolean;
}

export const LIMITS = {
  colors: [2, 6],
  minValue: [1, 10],
  maxValue: [5, 15],
  wagersPerColor: [0, 5],
  deckCopies: [1, 3],
  handSize: [4, 10],
  expeditionCost: [0, 80],
  bonusThreshold: [2, 20],
  bonusPoints: [0, 100],
  rounds: [1, 5],
  turnTimerSec: [0, 300],
  players: [2, 4],
} as const;

export const CLASSIC: GameConfig = {
  colors: 5,
  minValue: 2,
  maxValue: 10,
  wagersPerColor: 3,
  deckCopies: 1,
  handSize: 8,
  expeditionCost: 20,
  bonusThreshold: 8,
  bonusPoints: 20,
  bonusMultiplied: false,
  allowEqual: false,
  forbidRedrawDiscard: true,
  rounds: 1, // 기본 1판 (원작은 3판 — 로비에서 늘릴 수 있음)
  turnTimerSec: 0,
  showDeckCount: true,
  showScorePreview: true,
  revealDiscards: true,
  teams: false,
};

export interface Preset {
  id: string;
  label: string;
  description: string;
  config: GameConfig;
}

export const PRESETS: Preset[] = [
  { id: 'classic', label: '원작 (5색)', description: '2인 기본 규칙 그대로', config: CLASSIC },
  { id: 'long', label: '롱게임 (6색)', description: '원작의 6탐험대 변형', config: { ...CLASSIC, colors: 6 } },
  {
    id: 'three',
    label: '3인 권장',
    description: '6색 · 숫자 2~12 · 비용 자동 보정',
    config: { ...CLASSIC, colors: 6, maxValue: 12, expeditionCost: autoCost(2, 12) },
  },
  {
    id: 'four',
    label: '4인 권장',
    description: '5색 덱 2벌 · 같은 숫자 허용',
    config: { ...CLASSIC, deckCopies: 2, allowEqual: true },
  },
  {
    id: 'quick',
    label: '빠른 게임',
    description: '4색 · 1판 · 손패 6장',
    config: { ...CLASSIC, colors: 4, rounds: 1, handSize: 6, bonusThreshold: 7 },
  },
];

/** 원작 비율(2~10 합 54 대비 비용 20)을 유지하는 탐험대 비용 */
export function autoCost(minValue: number, maxValue: number): number {
  const sum = valueSum(minValue, maxValue);
  return Math.round((20 * sum) / 54);
}

function valueSum(minValue: number, maxValue: number): number {
  if (maxValue < minValue) return 0;
  return ((minValue + maxValue) * (maxValue - minValue + 1)) / 2;
}

export function deckSize(c: GameConfig): number {
  return c.colors * (c.maxValue - c.minValue + 1 + c.wagersPerColor) * c.deckCopies;
}

/** 플레이어 한 명당 덱에서 뽑게 되는 대략적인 횟수(≈ 턴 수) */
export function expectedTurns(c: GameConfig, players: number): number {
  return (deckSize(c) - players * c.handSize) / players;
}

export function validateConfig(c: GameConfig, players: number): string[] {
  const errors: string[] = [];
  const check = (key: keyof typeof LIMITS, v: number, label: string) => {
    const [lo, hi] = LIMITS[key];
    if (!Number.isInteger(v) || v < lo || v > hi) errors.push(`${label}은(는) ${lo}~${hi} 사이여야 합니다`);
  };
  check('colors', c.colors, '색 수');
  check('minValue', c.minValue, '최소 숫자');
  check('maxValue', c.maxValue, '최대 숫자');
  check('wagersPerColor', c.wagersPerColor, '와거 장수');
  check('deckCopies', c.deckCopies, '덱 배수');
  check('handSize', c.handSize, '손패');
  check('expeditionCost', c.expeditionCost, '탐험대 비용');
  check('bonusThreshold', c.bonusThreshold, '보너스 기준 장수');
  check('bonusPoints', c.bonusPoints, '보너스 점수');
  check('rounds', c.rounds, '판 수');
  check('turnTimerSec', c.turnTimerSec, '턴 제한시간');
  check('players', players, '인원');
  if (c.maxValue < c.minValue) errors.push('최대 숫자는 최소 숫자 이상이어야 합니다');
  if (c.teams && players !== 4) errors.push('팀전은 4인일 때만 가능합니다');
  if (errors.length === 0 && expectedTurns(c, players) < 3) {
    errors.push(`카드가 부족합니다 (덱 ${deckSize(c)}장, 인원당 약 ${expectedTurns(c, players).toFixed(1)}턴). 색·숫자 범위·덱 배수를 늘리거나 손패를 줄이세요`);
  }
  return errors;
}

export function sanitizeConfig(input: Partial<GameConfig>): GameConfig {
  const c: GameConfig = { ...CLASSIC };
  for (const key of Object.keys(CLASSIC) as (keyof GameConfig)[]) {
    const v = input[key];
    if (v === undefined) continue;
    if (typeof CLASSIC[key] === 'boolean' && typeof v === 'boolean') (c as any)[key] = v;
    if (typeof CLASSIC[key] === 'number' && typeof v === 'number' && Number.isFinite(v)) (c as any)[key] = Math.round(v);
  }
  return c;
}
