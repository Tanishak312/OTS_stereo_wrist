"use client";

import { useLayoutEffect, useState, type RefObject } from "react";

/**
 * Scale factor (≤ 1) that makes `inner` fit inside `outer`'s height, so a
 * fixed composition (the landing hero) never needs a scroll on short screens.
 * Uses transform-free offsetHeight, so applying the scale doesn't feed back.
 */
export function useFitHeight(outer: RefObject<HTMLElement | null>, inner: RefObject<HTMLElement | null>, minScale = 0.6) {
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    const measure = () => {
      const natural = i.offsetHeight;
      if (!natural) return;
      const next = Math.max(minScale, Math.min(1, o.clientHeight / natural));
      // The caller may widen `inner` by 1/scale, which can re-wrap text and nudge its height; ignore
      // sub-pixel changes so that can't loop.
      setScale((prev) => (Math.abs(prev - next) < 0.003 ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(o);
    ro.observe(i);
    return () => ro.disconnect();
  }, [outer, inner, minScale]);

  return scale;
}
