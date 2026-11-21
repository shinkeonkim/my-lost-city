import { describe, expect, it } from 'vitest';
import {
  CLASSIC,
  Card,
  MatchState,
  MoveError,
  PRESETS,
  applyMove,
  autoCost,
  autoMove,
  buildDeck,
  deckSize,
  expectedTurns,
  newMatch,
  scoreColumn,
  scorePlayer,
  startNextRound,
  validateConfig,
  viewFor,
} from './index';

const W = (color: number, i = 0): Card => ({ id: `${color}-w${i}`, color, value: 0 });
const N = (color: number, v: number): Card => ({ id: `${color}-${v}`, color, value: v });

function seeded(seed = 1) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

describe('점수 계산', () => {
  it('공식 매뉴얼 예시 = 18점', () => {
    const cols = [
      [N(0, 2), N(0, 3), N(0, 8), N(0, 10)], // 노랑 합 23 → 3
      [W(1)], // 흰색 와거만 → -40
      [], // 파랑 미시작 → 0
      [W(3), N(3, 7), N(3, 8)], // 초록 합 15, 와거 1 → -10
      [W(4, 0), W(4, 1), N(4, 2), N(4, 3), N(4, 4), N(4, 5), N(4, 6), N(4, 7), N(4, 8)], // 빨강 합 35, 와거 2, 9장 → 45+20
    ];
    const r = scorePlayer(CLASSIC, cols);
    expect(r.columns.map((x) => x.total)).toEqual([3, -40, 0, -10, 65]);
    expect(r.total).toBe(18);
  });

  it('보너스 배수 옵션', () => {
    const col = [W(0), ...[2, 3, 4, 5, 6, 7, 8].map((v) => N(0, v))];
    expect(scoreColumn(CLASSIC, col).total).toBe((35 - 20) * 2 + 20);
    expect(scoreColumn({ ...CLASSIC, bonusMultiplied: true }, col).total).toBe((35 - 20) * 2 + 40);
  });
});

describe('덱/설정', () => {
  it('원작 60장, 6색 72장', () => {
    expect(buildDeck(CLASSIC)).toHaveLength(60);
    expect(deckSize({ ...CLASSIC, colors: 6 })).toBe(72);
    expect(expectedTurns(CLASSIC, 2)).toBe(22);
  });
  it('autoCost는 원작 범위에서 20', () => {
    expect(autoCost(2, 10)).toBe(20);
    expect(autoCost(2, 12)).toBe(29);
  });
  it('카드 부족·팀전 검증', () => {
    expect(validateConfig(CLASSIC, 2)).toEqual([]);
    expect(validateConfig({ ...CLASSIC, colors: 2 }, 4).length).toBeGreaterThan(0);
    expect(validateConfig({ ...CLASSIC, teams: true }, 3).length).toBeGreaterThan(0);
  });
  it('모든 프리셋은 권장 인원에서 유효', () => {
    for (const p of PRESETS) expect(validateConfig(p.config, 2), p.id).toEqual([]);
    expect(validateConfig(PRESETS.find((p) => p.id === 'four')!.config, 4)).toEqual([]);
    expect(validateConfig(PRESETS.find((p) => p.id === 'three')!.config, 3)).toEqual([]);
  });
});

function setup(cfg = CLASSIC, players = 2): MatchState {
  const m = newMatch(cfg, players, seeded(7));
  return m;
}

describe('턴 규칙', () => {
  it('내기 → 뽑기 순서와 차례 강제', () => {
    const m = setup();
    const p = m.state.turn;
    const other = (p + 1) % 2;
    expect(() => applyMove(m, other, { type: 'discard', cardId: m.state.hands[other][0].id })).toThrow(MoveError);
    expect(() => applyMove(m, p, { type: 'draw', source: 'deck' })).toThrow(MoveError);
    applyMove(m, p, { type: 'discard', cardId: m.state.hands[p][0].id });
    expect(m.state.phase).toBe('draw');
    applyMove(m, p, { type: 'draw', source: 'deck' });
    expect(m.state.turn).toBe(other);
    expect(m.state.hands[p]).toHaveLength(8);
  });

  it('방금 버린 카드는 다시 못 가져옴', () => {
    const m = setup();
    const p = m.state.turn;
    const card = m.state.hands[p][0];
    applyMove(m, p, { type: 'discard', cardId: card.id });
    expect(() => applyMove(m, p, { type: 'draw', source: card.color })).toThrow(MoveError);
    const m2 = setup({ ...CLASSIC, forbidRedrawDiscard: false });
    const p2 = m2.state.turn;
    const c2 = m2.state.hands[p2][0];
    applyMove(m2, p2, { type: 'discard', cardId: c2.id });
    applyMove(m2, p2, { type: 'draw', source: c2.color });
    expect(m2.state.hands[p2].some((x) => x.id === c2.id)).toBe(true);
  });

  it('오름차순 / 와거는 숫자 앞에만', () => {
    const m = setup();
    const p = m.state.turn;
    m.state.hands[p] = [N(0, 5), N(0, 3), W(0), N(0, 6), N(1, 2), N(1, 3), N(1, 4), N(1, 5)];
    applyMove(m, p, { type: 'play', cardId: '0-5' });
    applyMove(m, p, { type: 'draw', source: 'deck' });
    const q = m.state.turn;
    applyMove(m, q, { type: 'discard', cardId: m.state.hands[q][0].id });
    applyMove(m, q, { type: 'draw', source: 'deck' });
    expect(() => applyMove(m, p, { type: 'play', cardId: '0-3' })).toThrow(MoveError);
    expect(() => applyMove(m, p, { type: 'play', cardId: '0-w0' })).toThrow(MoveError);
    applyMove(m, p, { type: 'play', cardId: '0-6' });
  });

  it('덱 소진 시 판 종료, 다음 판 첫 차례는 무작위', () => {
    const m = setup({ ...CLASSIC, rounds: 2 });
    let guard = 0;
    while (m.status === 'playing' && guard++ < 1000) {
      applyMove(m, m.state.turn, autoMove(m));
      if (m.status === 'playing') applyMove(m, m.state.turn, autoMove(m));
    }
    expect(m.status).toBe('round-over');
    expect(m.roundScores).toHaveLength(1);
    startNextRound(m, () => 0.99);
    expect(m.state.turn).toBe(1); // 점수와 무관하게 난수로 정함
    expect(m.roundStarter).toBe(1);
    expect(m.round).toBe(1);
  });

  it('첫 차례는 모든 자리에 고르게 돌아감', () => {
    for (const players of [2, 3, 4]) {
      const seen = new Set<number>();
      for (let seed = 1; seed <= 60; seed++) seen.add(newMatch(CLASSIC, players, seeded(seed * 7919)).state.turn);
      expect([...seen].sort()).toEqual(Array.from({ length: players }, (_, i) => i));
    }
  });

  it('뷰는 상대 손패를 숨김', () => {
    const m = setup(CLASSIC, 3);
    const v = viewFor(m, 1);
    expect(v.hand).toBe(m.state.hands[1]);
    expect(JSON.stringify(v)).not.toContain(JSON.stringify(m.state.hands[0][0]) + ',' + JSON.stringify(m.state.hands[0][1]));
    expect(v.handCounts).toEqual([8, 8, 8]);
    expect((v as any).deck).toBeUndefined();
  });

  it('같은 숫자 허용(덱 2벌)', () => {
    const cfg = { ...CLASSIC, deckCopies: 2, allowEqual: true };
    const m = setup(cfg, 4);
    const p = m.state.turn;
    m.state.hands[p] = [{ id: 'a', color: 0, value: 4 }, { id: 'b', color: 0, value: 4 }, ...m.state.hands[p].slice(2)];
    applyMove(m, p, { type: 'play', cardId: 'a' });
    applyMove(m, p, { type: 'draw', source: 'deck' });
    for (let i = 0; i < 3; i++) {
      applyMove(m, m.state.turn, autoMove(m));
      applyMove(m, m.state.turn, autoMove(m));
    }
    applyMove(m, p, { type: 'play', cardId: 'b' });
    expect(m.state.expeditions[p][0]).toHaveLength(2);
  });
});
