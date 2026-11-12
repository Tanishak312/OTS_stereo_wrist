"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { domainName } from "@/lib/catalog";

// Preview videos: one or more short clips per environment type, streamed by the server
// from /api/preview/<slug>?clip=<n> (src/lib/preview.ts). The browser only ever knows that
// URL and how many clips each type has; never where the videos are stored.

type Previews = {
  slugs: readonly string[];
  counts: Readonly<Record<string, number>>;
  /** The clip each type is on (1-based), shared by the card, the dialog and the preview card so they agree. */
  chosen: Readonly<Record<string, number>>;
  choose: (slug: string, clip: number) => void;
};
const PreviewContext = createContext<Previews>({ slugs: [], counts: {}, chosen: {}, choose: () => {} });

export function PreviewProvider({ clips, children }: { clips: Record<string, number>; children: ReactNode }) {
  const [chosen, setChosen] = useState<Record<string, number>>({});
  const choose = useCallback((slug: string, clip: number) => setChosen((c) => (c[slug] === clip ? c : { ...c, [slug]: clip })), []);
  const value = useMemo(
    () => ({ slugs: Object.keys(clips).filter((s) => clips[s] > 0), counts: clips, chosen, choose }),
    [clips, chosen, choose],
  );
  return <PreviewContext.Provider value={value}>{children}</PreviewContext.Provider>;
}

/** The URL of one clip. Clip 1 keeps the plain address. */
export const clipSrc = (slug: string, clip: number) => `/api/preview/${encodeURIComponent(slug)}${clip > 1 ? `?clip=${clip}` : ""}`;

const SLIDE_MS = 420;
const SLIDE_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

/**
 * Carousel move between two clips of one type, called just before the clip changes: a still of
 * the frame now showing slides out one side while the video (about to load the next clip) slides
 * in from the other. `by` 1 is next (out to the left), -1 previous. Nothing with reduced motion,
 * and only the slide-in when there is no frame to keep yet.
 */
export function slideClip(video: HTMLVideoElement | null, by: number) {
  if (!video || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const dir = by < 0 ? -1 : 1;
  let still: HTMLCanvasElement | null = null;
  if (video.readyState >= 2 && video.videoWidth) {
    try {
      still = document.createElement("canvas");
      still.width = video.videoWidth;
      still.height = video.videoHeight;
      still.getContext("2d")?.drawImage(video, 0, 0);
      const css = getComputedStyle(video);
      // Same box, fit and crop as the video, so the still lines up exactly with what was showing.
      Object.assign(still.style, {
        position: "absolute",
        inset: "0",
        width: "100%",
        height: "100%",
        objectFit: css.objectFit,
        objectPosition: css.objectPosition,
        pointerEvents: "none",
      });
      still.setAttribute("aria-hidden", "true");
      video.after(still);
    } catch {
      still?.remove();
      still = null;
    }
  }
  if (still) {
    const s = still;
    s.animate([{ transform: "translateX(0)" }, { transform: `translateX(${-dir * 100}%)` }], { duration: SLIDE_MS, easing: SLIDE_EASE, fill: "forwards" })
      .finished.catch(() => {})
      .finally(() => s.remove());
  }
  video.animate([{ transform: `translateX(${dir * 100}%)` }, { transform: "translateX(0)" }], { duration: SLIDE_MS, easing: SLIDE_EASE });
}

/** One environment type's clips: how many, which is showing, and stepping between them (wraps round). */
export function useClips(slug: string) {
  const { counts, chosen, choose } = useContext(PreviewContext);
  const count = Object.hasOwn(counts, slug) ? counts[slug] : 0;
  const clip = Math.min(Math.max(Object.hasOwn(chosen, slug) ? chosen[slug] : 1, 1), Math.max(count, 1));
  const step = useCallback((by: number) => count > 1 && choose(slug, ((clip - 1 + by + count) % count) + 1), [choose, slug, clip, count]);
  return { count, clip, step };
}

/**
 * The environment type shown in the steps' preview card, kept above the steps so it stays
 * the same from step 2 to step 4. Without a provider each card keeps its own.
 */
type Tab = [string | null, (slug: string | null) => void];
const PreviewTabContext = createContext<Tab | null>(null);

export function PreviewTabProvider({ value, children }: { value: Tab; children: ReactNode }) {
  return <PreviewTabContext.Provider value={value}>{children}</PreviewTabContext.Provider>;
}

/** Environment types with a preview. Empty while previews are switched off. */
export function usePreviewSlugs(): readonly string[] {
  return useContext(PreviewContext).slugs;
}

const Chevron = ({ dir }: { dir: "prev" | "next" }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4 lg:h-[18px] lg:w-[18px]">
    <path d={dir === "prev" ? "m14.5 6-6 6 6 6" : "m9.5 6 6 6-6 6"} stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * Round previous / next clip buttons on the left and right edges of a picture, with dots for
 * which clip is showing. Nothing when the type has one clip. Place inside a positioned box.
 */
export function ClipArrows({
  name,
  clip,
  count,
  onStep,
  className = "",
  dotsAt = "top-2",
}: {
  name: string;
  clip: number;
  count: number;
  onStep: (by: number) => void;
  /** Extra classes for the buttons and dots, e.g. to show them only on hover. */
  className?: string;
  /** Where the dots sit, clear of whatever else is on the picture. */
  dotsAt?: string;
}) {
  if (count < 2) return null;
  const button = `pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-ink shadow-[0_2px_8px_rgba(0,0,0,0.3)] backdrop-blur-sm transition-[opacity,background-color,transform,translate,scale] duration-150 hover:bg-white active:scale-90 lg:h-9 lg:w-9 ${className}`;
  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 top-1/2 z-20 flex -translate-y-1/2 items-center justify-between px-1.5 lg:px-2">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onStep(-1);
          }}
          aria-label={`Previous ${name} clip (${clip === 1 ? count : clip - 1} of ${count})`}
          className={button}
        >
          <Chevron dir="prev" />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onStep(1);
          }}
          aria-label={`Next ${name} clip (${clip === count ? 1 : clip + 1} of ${count})`}
          className={button}
        >
          <Chevron dir="next" />
        </button>
      </div>
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute ${dotsAt} left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/45 px-1.5 py-1 transition-opacity duration-150 ${className}`}
      >
        {Array.from({ length: count }, (_, i) => (
          <span key={i} className={`h-1.5 rounded-full transition-[width,background-color] duration-200 ${i + 1 === clip ? "w-3 bg-white" : "w-1.5 bg-white/55"}`} />
        ))}
      </span>
    </>
  );
}

/** True at and above `px` wide. False on the server and the first render, so a phone never loads both layouts. */
export function useMinWidth(px: number): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${px}px)`);
    const update = () => setWide(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [px]);
  return wide;
}

const clock = (s: number) => {
  const t = Number.isFinite(s) ? Math.max(0, Math.floor(s)) : 0;
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};

/**
 * One environment type's clip. The stereo video holds both eyes side by side
 * (3840 x 1200), so each half is labelled. The labels and the control bar (play /
 * pause, seek, time, full screen) sit on the video and show on hover, on a tap, or
 * while a control has keyboard focus; the big play button stays while paused so
 * it's clear this is a video. Always muted: recordings can carry voices.
 */
export function PreviewVideo({
  slug,
  className = "",
  autoPlay = false,
  startAt = 0,
}: {
  slug: string;
  className?: string;
  /** Start playing as soon as it can (muted, so browsers allow it). */
  autoPlay?: boolean;
  /** Seconds in, e.g. where a hover preview had got to. */
  startAt?: number;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [waiting, setWaiting] = useState(false);
  const [failed, setFailed] = useState(false);
  const [hover, setHover] = useState(false);
  const [full, setFull] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { clip, count, step } = useClips(slug);
  // startAt belongs to the clip that was showing when this player opened (where a hover had got to).
  const firstClip = useRef(clip);
  const from = clip === firstClip.current ? startAt : 0;
  const src = `${clipSrc(slug, clip)}#t=${from > 0.1 ? from.toFixed(2) : "0.1"}`;
  // Set by this player's own arrows: the new clip should play. A change made elsewhere (a card's arrows) only loads it.
  const playNext = useRef(false);
  const lastSrc = useRef(src);

  useEffect(() => {
    if (lastSrc.current === src) return;
    lastSrc.current = src;
    setFailed(false);
    setTime(0);
    setDuration(0);
    setPlaying(false);
    if (playNext.current || autoPlay) ref.current?.play().catch(() => {});
    playNext.current = false;
  }, [src, autoPlay]);

  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === wrapRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  /** Show the controls; with `ms`, hide them again after that long (touch, and full screen where the pointer never leaves). */
  const reveal = (ms?: number) => {
    setHover(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = ms ? setTimeout(() => setHover(false), ms) : null;
  };

  const toggle = () => {
    const v = ref.current;
    if (!v || failed) return;
    if (v.paused) v.play().catch(() => setFailed(true));
    else v.pause();
  };

  const toggleFull = () => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (wrap.requestFullscreen) wrap.requestFullscreen().catch(() => {});
    // iPhone Safari can only put the video itself in full screen, with its own controls.
    else (ref.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null)?.webkitEnterFullscreen?.();
  };

  const shown = hover && !failed;
  const fade = `transition-opacity duration-200 group-has-[:focus-visible]:opacity-100 ${shown ? "opacity-100" : "opacity-0"}`;
  // Only the controls themselves take clicks, and only while visible; the bar's shading never
  // swallows a click meant for the video or the play button.
  const clickable = shown ? "pointer-events-auto" : "pointer-events-none group-has-[:focus-visible]:pointer-events-auto";

  return (
    <div
      ref={wrapRef}
      onPointerEnter={(e) => e.pointerType === "mouse" && reveal()}
      onPointerMove={(e) => e.pointerType === "mouse" && reveal(full ? 2500 : undefined)}
      onPointerLeave={(e) => e.pointerType === "mouse" && setHover(false)}
      onPointerDown={(e) => e.pointerType !== "mouse" && reveal(3000)}
      className={`group relative overflow-hidden bg-[#0b1220] ${full ? "flex items-center justify-center" : "rounded-lg"} ${className}`}
    >
      <video
        ref={ref}
        // "#t=0.1" makes browsers draw the first frame instead of a black box.
        src={src}
        preload={autoPlay ? "auto" : "metadata"}
        autoPlay={autoPlay}
        muted
        playsInline
        disablePictureInPicture
        controlsList="nodownload noplaybackrate noremoteplayback"
        onContextMenu={(e) => e.preventDefault()}
        onClick={toggle}
        onDoubleClick={toggleFull}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => setWaiting(false)}
        onCanPlay={() => setWaiting(false)}
        onError={() => setFailed(true)}
        aria-label={`${domainName(slug)} preview`}
        className={`block w-full cursor-pointer bg-[#0b1220] object-contain ${full ? "h-full" : "aspect-[16/5]"}`}
      />

      {/* Left / right eye: the two halves of the frame. Full screen keeps them on the picture, which fills the width. */}
      {!failed && (
        <div aria-hidden="true" className={`pointer-events-none absolute inset-x-0 ${full ? "top-1/2 aspect-[16/5] -translate-y-1/2" : "inset-y-0"} ${fade}`}>
          <EyeLabel className="left-3">L · Left eye</EyeLabel>
          <EyeLabel className="left-[calc(50%+12px)]">R · Right eye</EyeLabel>
          <span className="absolute inset-y-0 left-1/2 w-px bg-white/25" />
        </div>
      )}

      {/* Watermark: the Awign mark and name, fixed in the top-right corner of each eye, always on
          (also in full screen, where this box stays on the picture). Drawn over the picture, not into
          it: the file itself is unmarked until previews are re-encoded. */}
      {!failed && (
        <div aria-hidden="true" className={`pointer-events-none absolute inset-x-0 z-10 select-none ${full ? "top-1/2 aspect-[16/5] -translate-y-1/2" : "inset-y-0"}`}>
          <Watermark full={full} className="right-[calc(50%+10px)]" />
          <Watermark full={full} className="right-2.5" />
        </div>
      )}

      {/* Other clips of this type. Always shown (a tap has no hover); the dots sit above the control bar, clear of the eye labels. */}
      <ClipArrows
        name={domainName(slug)}
        clip={clip}
        count={count}
        dotsAt={full ? "bottom-16" : "bottom-11 lg:bottom-12"}
        onStep={(by) => {
          playNext.current = true;
          slideClip(ref.current, by);
          step(by);
        }}
      />

      {failed ? (
        <p role="status" className="absolute inset-0 flex items-center justify-center px-6 text-center text-[14px] text-white/80">
          This preview can&rsquo;t play here. Try Chrome, Edge or Safari.
        </p>
      ) : (
        (!playing || waiting) && (
          <button
            type="button"
            onClick={toggle}
            aria-label={playing ? "Loading" : `Play ${domainName(slug)} preview`}
            // Shows with the rest of the controls (hover, tap, keyboard focus); a spinner while loading always shows.
            className={`absolute top-1/2 left-1/2 z-20 ${waiting && playing ? "opacity-100" : `${fade} ${clickable}`} flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-ink shadow-lg transition-transform duration-150 hover:scale-105 active:scale-95 lg:h-16 lg:w-16`}
          >
            {waiting && playing ? (
              <span className="h-6 w-6 animate-spin rounded-full border-2 border-ink/20 border-t-ink" />
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" className="ml-0.5">
                <path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z" fill="currentColor" />
              </svg>
            )}
          </button>
        )
      )}

      {/* Control bar, over the bottom of the picture. Invisible controls can't be clicked by accident. */}
      {!failed && (
        <div
          data-controls
          className={`pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-center gap-3 bg-gradient-to-t from-black/75 via-black/40 to-transparent px-4 pt-6 pb-2.5 lg:gap-4 lg:px-5 ${fade}`}
        >
          <button type="button" onClick={toggle} aria-label={playing ? "Pause" : "Play"} className={`${clickable} -ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white hover:bg-white/15`}>
            {playing ? (
              <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 4h4v16H6zM14 4h4v16h-4z" fill="currentColor" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z" fill="currentColor" />
              </svg>
            )}
          </button>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={Math.min(time, duration || 0)}
            disabled={!duration}
            onChange={(e) => {
              const v = ref.current;
              if (v) v.currentTime = Number(e.target.value);
            }}
            aria-label="Seek"
            aria-valuetext={`${clock(time)} of ${clock(duration)}`}
            style={{ ["--done" as string]: `${duration ? (Math.min(time, duration) / duration) * 100 : 0}%` }}
            className={`${clickable} preview-seek h-1 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-[linear-gradient(to_right,var(--color-brand)_var(--done),rgba(255,255,255,0.25)_var(--done))] disabled:cursor-default`}
          />
          <span className="tabular shrink-0 font-mono text-[12px] tracking-wider text-white lg:text-[13px]">
            {clock(time)} / {clock(duration)}
          </span>
          <button
            type="button"
            onClick={toggleFull}
            aria-label={full ? "Exit full screen" : "Full screen"}
            className={`${clickable} -mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white hover:bg-white/15`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              {full ? (
                <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              ) : (
                <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              )}
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}

function Watermark({ full, className }: { full: boolean; className: string }) {
  return (
    <span
      className={`absolute top-2.5 flex items-center gap-1.5 font-semibold tracking-[0.02em] text-white opacity-60 [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.6))] ${
        full ? "top-5 gap-2.5 text-[24px]" : "text-[12px] lg:text-[14px]"
      } ${className}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/images/awign-mark.png" alt="" width={63} height={63} className={`w-auto brightness-0 invert ${full ? "h-7" : "h-3.5 lg:h-4"}`} />
      Awign
    </span>
  );
}

function EyeLabel({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span
      className={`absolute top-3 rounded bg-black/55 px-2 py-1 font-mono text-[10px] tracking-[0.14em] text-white uppercase lg:text-[11px] ${className}`}
    >
      {children}
    </span>
  );
}

/**
 * Step 2's preview card: the picked environment types that have a clip, one at a
 * time, with chips to jump and Previous / Next to step through them.
 */
export function StepPreview({ picked }: { picked: string[] }) {
  const available = usePreviewSlugs();
  const list = picked.filter((s) => available.includes(s));
  const shared = useContext(PreviewTabContext);
  const local = useState<string | null>(null);
  const [active, setActive] = shared ?? local;
  const seen = useRef<string[]>(list);

  // A type just picked comes to the front; if the shown one is dropped, show the last still picked.
  useEffect(() => {
    const added = list.find((s) => !seen.current.includes(s));
    seen.current = list;
    if (added) setActive(added);
    else if (!active || !list.includes(active)) setActive(list[list.length - 1] ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.join("|")]);

  const chipsRef = useRef<HTMLDivElement>(null);
  // Bring the shown chip into view by sliding the chip row only. Never scrollIntoView: that also
  // scrolls the page, which pulled every step down to this card the moment it opened.
  useEffect(() => {
    const row = chipsRef.current;
    const chip = row?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!row || !chip) return;
    const left = chip.offsetLeft;
    const right = left + chip.offsetWidth;
    if (left < row.scrollLeft) row.scrollTo({ left: left - 4, behavior: "smooth" });
    else if (right > row.scrollLeft + row.clientWidth) row.scrollTo({ left: right - row.clientWidth + 4, behavior: "smooth" });
  }, [active]);

  if (!list.length) return null;
  const current = active && list.includes(active) ? active : list[0];
  const i = list.indexOf(current);
  const prev = i > 0 ? list[i - 1] : null;
  const next = i < list.length - 1 ? list[i + 1] : null;

  return (
    <section aria-label="Preview" className="mt-4 animate-fade-up rounded-[22px] border-[1.5px] border-[#ececec] bg-white p-5 lg:mt-6">
      <div className="flex items-center justify-between gap-4">
        <p className="font-mono text-[12px] tracking-[0.18em] text-brand uppercase">Preview</p>
        <p className="tabular font-mono text-[12px] tracking-[0.14em] text-muted uppercase">{list.length} selected</p>
      </div>
      <div ref={chipsRef} className="relative -mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
        {list.map((s) => {
          const on = s === current;
          return (
            <button
              key={s}
              type="button"
              aria-pressed={on}
              onClick={() => setActive(s)}
              className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-full border px-4 text-[15px] whitespace-nowrap transition-colors duration-150 ${
                on ? "border-brand bg-brand text-white" : "border-line bg-white text-ink hover:border-subtle"
              }`}
            >
              {on && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-white" />}
              {domainName(s)}
            </button>
          );
        })}
      </div>
      <PreviewVideo key={current} slug={current} className="-mx-3 mt-3" />
      <div className="mt-2 flex items-center justify-between gap-3 text-[15px]">
        <button
          type="button"
          disabled={!prev}
          onClick={() => prev && setActive(prev)}
          className="inline-flex min-h-10 items-center gap-1.5 text-ink enabled:hover:underline disabled:text-subtle"
        >
          <span aria-hidden="true">&larr;</span> Previous
        </button>
        <span className="tabular shrink-0 font-mono text-[12px] tracking-[0.14em] text-muted uppercase">
          {i + 1} of {list.length}
        </span>
        <button
          type="button"
          disabled={!next}
          onClick={() => next && setActive(next)}
          className="inline-flex min-h-10 min-w-0 items-center gap-1.5 text-right font-medium text-brand enabled:hover:underline disabled:font-normal disabled:text-subtle"
        >
          <span className="truncate">{next ? `Next: ${domainName(next)}` : "Next"}</span> <span aria-hidden="true">&rarr;</span>
        </button>
      </div>
    </section>
  );
}
