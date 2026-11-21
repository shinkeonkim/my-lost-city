import type { Card } from '@el/engine';

export interface Suit {
  name: string;
  /** CSS 변수 이름 접미사 */
  key: string;
}

export const SUITS: Suit[] = [
  { name: '사막', key: 'sun' },
  { name: '심해', key: 'sea' },
  { name: '설산', key: 'snow' },
  { name: '밀림', key: 'leaf' },
  { name: '화산', key: 'ember' },
  { name: '성운', key: 'star' },
];

export function suitVars(color: number): React.CSSProperties {
  const k = SUITS[color]?.key ?? 'sun';
  return { ['--suit' as string]: `var(--${k})`, ['--suit-ink' as string]: `var(--${k}-ink)` };
}

export function glyphPaths(color: number) {
  switch (color) {
    case 0:
      return (
        <>
          <circle cx="12" cy="9" r="4" />
          <path d="M2 20c4-4 8-4 10-2s6 2 10-2v4H2z" />
        </>
      );
    case 1:
      return (
        <>
          <path d="M2 9c3-3 5-3 7 0s4 3 6 0 4-3 7 0v3c-3-3-5-3-7 0s-4 3-6 0-4-3-7 0z" />
          <path d="M2 16c3-3 5-3 7 0s4 3 6 0 4-3 7 0v3c-3-3-5-3-7 0s-4 3-6 0-4-3-7 0z" opacity=".6" />
        </>
      );
    case 2:
      return (
        <>
          <path d="M1 21 9 6l4 7 3-4 7 12z" />
        </>
      );
    case 3:
      return (
        <>
          <path d="M20 3C9 3 4 9 4 17c0 1.5.3 2.7.6 3.5C7 12 12 9 16 8c-5 3-8 7-9.5 13 9 1 14-6 13.5-18z" />
        </>
      );
    case 4:
      return (
        <>
          <path d="M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-6 0 2 1 3 2 3 0-3-1-6 1-9z" />
        </>
      );
    default:
      return (
        <>
          <path d="m12 2 2.6 6.9L22 9.3l-5.6 4.8 1.8 7.2L12 17.3l-6.2 4 1.8-7.2L2 9.3l7.4-.4z" />
        </>
      );
  }
}


export function Glyph({ color, size = 14 }: { color: number; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      {glyphPaths(color)}
    </svg>
  );
}

export function cardLabel(c: Card): string {
  return `${SUITS[c.color]?.name ?? c.color} ${c.value === 0 ? '투자' : c.value}`;
}
