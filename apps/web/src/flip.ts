import { RefObject, useLayoutEffect } from 'react';

/**
 * 카드가 "어디서 날아왔는지" 기록해 두면, 그 카드가 새 위치에 마운트될 때
 * 원래 자리에서 새 자리로 미끄러져 들어온다 (FLIP 애니메이션).
 */
interface Origin {
  rect: DOMRect;
  delay: number;
  flip: boolean;
}
const origins = new Map<string, Origin>();

export const reducedMotion = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export const hasOrigin = (cardId: string) => origins.has(cardId);

export function setOrigin(cardId: string, el: Element | null | undefined, opts: { delay?: number; flip?: boolean } = {}) {
  if (!el) return;
  origins.set(cardId, { rect: el.getBoundingClientRect(), delay: opts.delay ?? 0, flip: !!opts.flip });
  // 마운트되지 않으면 오래된 기록이 남지 않게 정리
  setTimeout(() => origins.delete(cardId), 3000);
}

export function useFlyIn(cardId: string, ref: RefObject<HTMLElement>) {
  useLayoutEffect(() => {
    const el = ref.current;
    const o = origins.get(cardId);
    if (!el || !o) return;
    origins.delete(cardId);
    if (reducedMotion() || !el.animate) return;
    const to = el.getBoundingClientRect();
    if (to.width === 0) return;
    const dx = o.rect.left + o.rect.width / 2 - (to.left + to.width / 2);
    const dy = o.rect.top + o.rect.height / 2 - (to.top + to.height / 2);
    const s = o.rect.width / to.width || 1;
    const start = `translate(${dx}px, ${dy}px) scale(${s})${o.flip ? ' rotateY(90deg)' : ''}`;
    el.style.zIndex = '30';
    const anim = el.animate(
      [
        { transform: start, offset: 0 },
        { transform: `translate(${dx * 0.15}px, ${dy * 0.15 - 14}px) scale(1.08)`, offset: 0.7 },
        { transform: 'none', offset: 1 },
      ],
      { duration: 480, delay: o.delay, easing: 'cubic-bezier(.2,.75,.25,1)', fill: 'backwards' },
    );
    anim.onfinish = anim.oncancel = () => {
      el.style.zIndex = '';
    };
  }, [cardId, ref]);
}
