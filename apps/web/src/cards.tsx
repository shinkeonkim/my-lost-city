import { forwardRef, useRef } from 'react';
import type { Card } from '@el/engine';
import { Glyph, cardLabel, glyphPaths, suitVars } from './theme';
import { useFlyIn } from './flip';

/**
 * 카드 일러스트 (자체 제작 SVG).
 * 숫자가 클수록 목적지인 고대 유적의 실루엣이 가까워지고 선명해진다 — "탐험이 진행될수록 도착에 가까워진다".
 */
function Scene({ color, t }: { color: number; t: number }) {
  // t: 0(가장 작은 숫자) ~ 1(가장 큰 숫자), 투자 카드는 -1
  const ruinScale = t < 0 ? 0 : 0.45 + 0.55 * t;
  const ruinOpacity = t < 0 ? 0 : 0.25 + 0.65 * t;
  const ruin = (
    <g transform={`translate(30 66) scale(${ruinScale}) translate(-30 -66)`} opacity={ruinOpacity} fill="var(--ruin)">
      <path d="M14 66V54h4v-6h4v-6h16v6h4v6h4v12H35V56h-10v10z" />
      <rect x="27" y="36" width="6" height="6" />
    </g>
  );
  switch (color) {
    case 0: // 사막
      return (
        <>
          <rect width="60" height="84" fill="url(#g-sun)" />
          <circle cx="44" cy="20" r="9" fill="#fff4c9" opacity=".85" />
          {ruin}
          <path d="M0 62c12-8 22-8 34-2s18 4 26 0v24H0z" fill="#c98a1e" />
          <path d="M0 72c14-6 26-4 36 0s16 4 24 0v12H0z" fill="#a86d12" />
        </>
      );
    case 1: // 심해
      return (
        <>
          <rect width="60" height="84" fill="url(#g-sea)" />
          <g fill="none" stroke="#bfe0ff" strokeOpacity=".35" strokeWidth="1.4">
            <path d="M-2 14c6-4 10-4 16 0s10 4 16 0 10-4 16 0 10 4 16 0" />
            <path d="M-2 22c6-4 10-4 16 0s10 4 16 0 10-4 16 0 10 4 16 0" />
          </g>
          <g fill="#d9efff" opacity=".5">
            <circle cx="12" cy="40" r="1.6" />
            <circle cx="16" cy="33" r="1" />
            <circle cx="47" cy="46" r="1.3" />
          </g>
          {ruin}
          <path d="M0 70c10-5 18-3 26 0s20 4 34-2v16H0z" fill="#123d6b" />
        </>
      );
    case 2: // 설산
      return (
        <>
          <rect width="60" height="84" fill="url(#g-snow)" />
          <path d="M-4 66 18 30l10 14 8-10 28 32z" fill="#f7f9fc" />
          <path d="M18 30l10 14-4 2-6-6-5 4z" fill="#c4ccd8" />
          <path d="M36 34l28 32H40l4-14z" fill="#d5dbe4" />
          {ruin}
          <path d="M0 70h60v14H0z" fill="#aeb8c6" />
        </>
      );
    case 3: // 밀림
      return (
        <>
          <rect width="60" height="84" fill="url(#g-leaf)" />
          <g fill="#1f6b3e" opacity=".9">
            <path d="M-6 30C8 18 18 22 22 34 12 30 4 32-6 40z" />
            <path d="M66 22C52 12 40 18 38 30c10-6 18-4 28 4z" />
          </g>
          {ruin}
          <g fill="#164f2d">
            <path d="M0 64c8-10 16-10 22-2 6-10 16-12 24-2 6-6 10-6 14-2v26H0z" />
          </g>
        </>
      );
    case 4: // 화산
      return (
        <>
          <rect width="60" height="84" fill="url(#g-ember)" />
          <path d="M6 70 24 34h12l18 36z" fill="#3b1410" />
          <path d="M24 34c2 6 4 8 6 14 2-6 4-8 6-14z" fill="#ff8a3d" />
          <g fill="#ffb37a" opacity=".7">
            <circle cx="28" cy="22" r="2" />
            <circle cx="34" cy="16" r="1.4" />
            <circle cx="24" cy="12" r="1" />
          </g>
          {ruin}
          <path d="M0 72h60v12H0z" fill="#2a0d0a" />
        </>
      );
    default: // 성운
      return (
        <>
          <rect width="60" height="84" fill="url(#g-star)" />
          <g fill="#fff">
            <circle cx="8" cy="10" r=".9" />
            <circle cx="50" cy="8" r="1.2" />
            <circle cx="40" cy="28" r=".7" />
            <circle cx="14" cy="36" r=".8" />
            <circle cx="54" cy="40" r=".9" />
          </g>
          <ellipse cx="22" cy="22" rx="11" ry="3" fill="none" stroke="#e5d3ff" strokeOpacity=".6" />
          <circle cx="22" cy="22" r="6" fill="#c7a6ff" />
          {ruin}
          <path d="M0 70c14-4 26-4 40 0s14 2 20 0v14H0z" fill="#2a1650" />
        </>
      );
  }
}

/**
 * 투자(와거) 카드: 탐험대 후원 증서 느낌 — 색 바탕 + 금빛 햇살, 장식 테두리,
 * 가운데 탐험대 문장이 새겨진 금화 메달, 아래 "투자" 리본.
 */
function WagerArt({ color }: { color: number }) {
  const rays = Array.from({ length: 18 }, (_, i) => i * 20);
  const beads = Array.from({ length: 16 }, (_, i) => (i * Math.PI * 2) / 16);
  return (
    <>
      <rect width="60" height="84" style={{ fill: 'var(--suit)' }} />
      <rect width="60" height="84" fill="url(#g-wager-shade)" />
      {/* 은은한 마름모 무늬 */}
      <rect width="60" height="84" fill="url(#p-diamond)" opacity=".22" />
      {/* 햇살 */}
      <g transform="translate(30 38)" fill="#ffe3a0" opacity=".2">
        {rays.map((a) => (
          <path key={a} d="M-1.6 0L0-40 1.6 0z" transform={`rotate(${a})`} />
        ))}
      </g>
      {/* 장식 테두리 */}
      <rect x="4" y="4" width="52" height="76" rx="3.5" fill="none" stroke="#f0cf7f" strokeWidth=".9" />
      <rect x="6" y="6" width="48" height="72" rx="2.5" fill="none" stroke="#f0cf7f" strokeWidth=".4" strokeOpacity=".7" />
      {[
        [6, 6],
        [54, 6],
        [6, 78],
        [54, 78],
      ].map(([x, y]) => (
        <path key={`${x}-${y}`} d={`M${x} ${y - 2.2}l2.2 2.2-2.2 2.2-2.2-2.2z`} fill="#f0cf7f" />
      ))}
      {/* 메달 */}
      <g transform="translate(30 38)">
        <circle r="15.5" fill="#000" opacity=".28" transform="translate(0 1.4)" />
        <circle r="15" fill="url(#g-gold)" stroke="#7a4d0c" strokeWidth=".8" />
        {beads.map((a, i) => (
          <circle key={i} cx={Math.cos(a) * 12.6} cy={Math.sin(a) * 12.6} r=".75" fill="#8a5a12" />
        ))}
        <circle r="10.4" fill="url(#g-gold-in)" stroke="#8a5a12" strokeWidth=".6" />
        <svg x="-6.5" y="-6.5" width="13" height="13" viewBox="0 0 24 24" fill="#6b430a">
          {glyphPaths(color)}
        </svg>
        <ellipse cx="-5" cy="-8" rx="5" ry="2.2" fill="#fff" opacity=".35" transform="rotate(-30 -5 -8)" />
      </g>
      {/* 리본 */}
      <g transform="translate(30 62)">
        <path d="M-22 -1l4 3.5-4 3.5h8v-7z" fill="#5e1410" />
        <path d="M22 -1l-4 3.5 4 3.5h-8v-7z" fill="#5e1410" />
        <path d="M-16 -4.5h32l-1.5 4.5 1.5 4.5h-32l1.5-4.5z" fill="#a3261d" stroke="#f0cf7f" strokeWidth=".6" />
        <text y="2.4" textAnchor="middle" fontSize="6.4" fontWeight="800" fill="#ffe7b0" letterSpacing=".8">
          투자
        </text>
      </g>
    </>
  );
}

/** 페이지에 한 번만 두는 그라디언트 정의 */
export function CardDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
      <defs>
        <linearGradient id="g-sun" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffe3a0" />
          <stop offset="1" stopColor="#e9a63a" />
        </linearGradient>
        <linearGradient id="g-sea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3f8fdc" />
          <stop offset="1" stopColor="#164f8c" />
        </linearGradient>
        <linearGradient id="g-snow" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#b9cbe0" />
          <stop offset="1" stopColor="#e9eef5" />
        </linearGradient>
        <linearGradient id="g-leaf" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7fcf8f" />
          <stop offset="1" stopColor="#2e8a52" />
        </linearGradient>
        <linearGradient id="g-ember" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff9b5a" />
          <stop offset="1" stopColor="#9c2a1c" />
        </linearGradient>
        <radialGradient id="g-gold" cx=".38" cy=".32" r=".75">
          <stop offset="0" stopColor="#fff6cf" />
          <stop offset=".45" stopColor="#f0c55a" />
          <stop offset="1" stopColor="#a8711a" />
        </radialGradient>
        <radialGradient id="g-gold-in" cx=".5" cy=".4" r=".7">
          <stop offset="0" stopColor="#f7d784" />
          <stop offset="1" stopColor="#c08a2a" />
        </radialGradient>
        <linearGradient id="g-wager-shade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#000" stopOpacity=".15" />
          <stop offset="1" stopColor="#000" stopOpacity=".6" />
        </linearGradient>
        <pattern id="p-diamond" width="8" height="8" patternUnits="userSpaceOnUse">
          <path d="M4 0 8 4 4 8 0 4z" fill="none" stroke="#fff" strokeWidth=".5" />
        </pattern>
        <linearGradient id="g-star" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a2470" />
          <stop offset="1" stopColor="#8a5bd3" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export type CardSize = 'xs' | 'sm' | 'md';

interface CardProps {
  card: Card;
  size?: CardSize;
  /** 숫자 범위 (일러스트 진행도 계산용) */
  range?: [number, number];
  selected?: boolean;
  dim?: boolean;
  fresh?: boolean;
  onClick?: () => void;
  onPointerDown?: (e: React.PointerEvent<HTMLElement>) => void;
  className?: string;
  style?: React.CSSProperties;
}

export const CardFace = forwardRef<HTMLElement, CardProps>(function CardFace(
  { card, size = 'md', range = [2, 10], selected, dim, fresh, onClick, onPointerDown, className = '', style },
  outerRef,
) {
  const innerRef = useRef<HTMLElement>(null);
  useFlyIn(card.id, innerRef);
  const wager = card.value === 0;
  const t = wager ? -1 : range[1] === range[0] ? 1 : (card.value - range[0]) / (range[1] - range[0]);
  const El = (onClick ? 'button' : 'div') as 'div';
  const setRef = (el: HTMLElement | null) => {
    (innerRef as React.MutableRefObject<HTMLElement | null>).current = el;
    if (typeof outerRef === 'function') outerRef(el);
    else if (outerRef) outerRef.current = el;
  };
  const label = wager ? '×' : String(card.value);
  return (
    <El
      ref={setRef as any}
      className={`card ${size} ${wager ? 'wager' : ''} ${selected ? 'selected' : ''} ${dim ? 'dim' : ''} ${fresh ? 'fresh' : ''} ${className}`}
      style={{ ...suitVars(card.color), ...style }}
      onClick={onClick}
      onPointerDown={onPointerDown}
      aria-label={cardLabel(card)}
      aria-pressed={onClick ? !!selected : undefined}
      data-card={card.id}
    >
      <svg className="art" viewBox="0 0 60 84" preserveAspectRatio="xMidYMid slice" aria-hidden>
        {wager ? <WagerArt color={card.color} /> : <Scene color={card.color} t={t} />}
      </svg>
      <span className="idx tl">
        {wager ? <i className="coin">×</i> : <b>{label}</b>}
        <Glyph color={card.color} size={size === 'xs' ? 7 : 9} />
      </span>
      {size !== 'xs' && <span className="idx br">{wager ? <i className="coin">×</i> : label}</span>}
      {size !== 'xs' && !wager && <span className="num">{card.value}</span>}
    </El>
  );
});

export const CardBack = forwardRef<HTMLDivElement, { size?: CardSize; className?: string }>(function CardBack({ size = 'md', className = '' }, ref) {
  return (
    <div ref={ref} className={`card back ${size} ${className}`} aria-hidden>
      <svg className="art" viewBox="0 0 60 84" preserveAspectRatio="xMidYMid slice">
        <rect width="60" height="84" fill="#2a241b" />
        <rect x="4" y="4" width="52" height="76" rx="4" fill="none" stroke="#d9a441" strokeOpacity=".6" />
        <g transform="translate(30 42)" fill="#d9a441">
          <circle r="13" fill="none" stroke="#d9a441" strokeOpacity=".7" />
          <path d="M0-17 3-3 0 0-3-3z" />
          <path d="M0 17 3 3 0 0-3 3z" opacity=".55" />
          <path d="M-17 0-3-3 0 0-3 3z" opacity=".55" />
          <path d="M17 0 3-3 0 0 3 3z" opacity=".55" />
        </g>
      </svg>
    </div>
  );
});
