"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

/** Gap between items in a staggered entrance. */
const STAGGER_MS = 55;
/** Long lists stop staggering after this many items so the last ones aren't late. */
const STAGGER_CAP = 10;

/** Inline delay for the i-th item of a staggered entrance, after an optional base delay. */
export function stagger(i: number, baseMs = 0): CSSProperties {
  return { animationDelay: `${baseMs + Math.min(i, STAGGER_CAP) * STAGGER_MS}ms` };
}

export function delay(ms: number): CSSProperties {
  return { animationDelay: `${ms}ms` };
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** True once the element has scrolled into view, and stays true, so its entrance plays only once. */
export function useInView<T extends Element>() {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion() || typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setSeen(true);
        io.disconnect();
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return [ref, seen] as const;
}

/**
 * Tweens a number towards `target`. Starts from `from` on mount (count-up on
 * page load), then animates from the current value on every change.
 */
export function useCountUp(target: number, { from = target, duration = 600, startDelay = 0 } = {}) {
  const [value, setValue] = useState(from);
  const current = useRef(from);

  useEffect(() => {
    if (prefersReducedMotion()) {
      current.current = target;
      setValue(target);
      return;
    }
    const start = current.current;
    if (start === target) return;
    let raf = 0;
    let t0 = 0;
    const timer = setTimeout(() => {
      const tick = (t: number) => {
        if (!t0) t0 = t;
        const p = Math.min(1, (t - t0) / duration);
        const eased = 1 - Math.pow(1 - p, 4);
        const v = start + (target - start) * eased;
        current.current = v;
        setValue(v);
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }, startDelay);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, [target, duration, startDelay]);

  return value;
}
