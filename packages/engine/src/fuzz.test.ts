import { describe, expect, it } from 'vitest';
import { CLASSIC, GameConfig, MoveError, PRESETS, applyMove, deckSize, newMatch, startNextRound, validateConfig } from './index';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** 무작위(합법/불법 섞인) 행동으로 매치를 끝까지 돌리며 불변식을 검사 */
function fuzz(cfg: GameConfig, players: number, seed: number) {
  const r = rng(seed);
  const m = newMatch(cfg, players, r);
  const total = deckSize(cfg);
  let steps = 0;
  while (m.status !== 'match-over') {
    if (m.status === 'round-over') {
      startNextRound(m, r);
      continue;
    }
    if (++steps > 20000) throw new Error('끝나지 않음');
    const s = m.state;
    // 카드 보존: 덱+손패+탐험대+버림 = 전체, 중복 없음
    const all = [...s.deck, ...s.hands.flat(), ...s.expeditions.flat(2), ...s.discards.flat()];
    expect(all.length).toBe(total);
    expect(new Set(all.map((c) => c.id)).size).toBe(total);
    // 탐험대 순서 불변식
    for (const cols of s.expeditions)
      for (const col of cols) {
        const nums = col.filter((c) => c.value > 0).map((c) => c.value);
        const firstNum = col.findIndex((c) => c.value > 0);
        if (firstNum >= 0) expect(col.slice(firstNum).every((c) => c.value > 0)).toBe(true);
        for (let i = 1; i < nums.length; i++) expect(cfg.allowEqual ? nums[i] >= nums[i - 1] : nums[i] > nums[i - 1]).toBe(true);
      }
    // 무작위 행동 (가끔 엉뚱한 플레이어/불법 수)
    const p = r() < 0.1 ? Math.floor(r() * players) : s.turn;
    const hand = s.hands[p];
    let move;
    if (s.phase === 'play' || r() < 0.05) {
      const card = hand[Math.floor(r() * hand.length)];
      move = { type: r() < 0.5 ? 'play' : 'discard', cardId: card?.id ?? 'x' } as const;
    } else {
      const src = r() < 0.6 ? 'deck' : Math.floor(r() * cfg.colors);
      move = { type: 'draw', source: src } as const;
    }
    try {
      applyMove(m, p, move);
    } catch (e) {
      if (!(e instanceof MoveError)) throw e;
    }
  }
  expect(m.roundScores).toHaveLength(cfg.rounds);
}

describe('퍼즈: 무작위 플레이 불변식', () => {
  const configs: [string, GameConfig, number][] = [
    ['classic-2p', CLASSIC, 2],
    ...PRESETS.map((p) => [p.id, p.config, p.id === 'three' ? 3 : p.id === 'four' ? 4 : 2] as [string, GameConfig, number]),
    ['2색 최소', { ...CLASSIC, colors: 2, handSize: 4, rounds: 2 }, 2],
    ['투자0·같은수', { ...CLASSIC, wagersPerColor: 0, allowEqual: true, deckCopies: 2 }, 4],
    ['재획득 허용', { ...CLASSIC, forbidRedrawDiscard: false, rounds: 1 }, 3],
  ];
  for (const [name, cfg, players] of configs) {
    it(`${name} (${players}인)`, () => {
      expect(validateConfig(cfg, players)).toEqual([]);
      for (let seed = 1; seed <= 15; seed++) fuzz(cfg, players, seed);
    });
  }
});
