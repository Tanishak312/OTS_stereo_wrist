"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { domainName, type SetupId } from "@/lib/catalog";

// Preview videos: one or more short clips per capture setup and environment type, streamed by
// the server from /api/preview/<slug>?setup=<setup>&clip=<n> (src/lib/preview.ts). The browser
// only ever knows that URL and how many clips each type has; never where the videos are stored.
//   Ego-centric:  one stereo frame, both eyes side by side (16:5).
//   Head + wrist: head stereo on top, left and right wrist below (16:10).

/** Clips per setup and environment type, as the server counted them. */
export type ClipCounts = Readonly<Record<SetupId, Readonly<Record<string, number>>>>;

type Previews = {
  counts: ClipCounts;
  /** The clip each setup's type is on (1-based), shared by the card, the dialog and the preview card so they agree. */
  chosen: Readonly<Record<string, number>>;
  choose: (key: string, clip: number) => void;
};
const PreviewContext = createContext<Previews>({ counts: { ego: {}, head_wrist: {} }, chosen: {}, choose: () => {} });

export function PreviewProvider({ clips, children }: { clips: ClipCounts; children: ReactNode }) {
  const [chosen, setChosen] = useState<Record<string, number>>({});
  const choose = useCallback((key: string, clip: number) => setChosen((c) => (c[key] === clip ? c : { ...c, [key]: clip })), []);
  const value = useMemo(() => ({ counts: clips, chosen, choose }), [clips, chosen, choose]);
  return <PreviewContext.Provider value={value}>{children}</PreviewContext.Provider>;
}

/** The URL of one clip. Ego-centric clip 1 keeps the plain address. */
export function clipSrc(slug: string, clip: number, setup: SetupId = "ego") {
  const q = [setup !== "ego" && `setup=${setup}`, clip > 1 && `clip=${clip}`].filter(Boolean).join("&");
  return `/api/preview/${encodeURIComponent(slug)}${q ? `?${q}` : ""}`;
}

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
export function useClips(slug: string, setup: SetupId = "ego") {
  const { counts, chosen, choose } = useContext(PreviewContext);
  const mine = counts[setup];
  const key = `${setup}:${slug}`;
  const count = Object.hasOwn(mine, slug) ? mine[slug] : 0;
  const clip = Math.min(Math.max(Object.hasOwn(chosen, key) ? chosen[key] : 1, 1), Math.max(count, 1));
  const step = useCallback((by: number) => count > 1 && choose(key, ((clip - 1 + by + count) % count) + 1), [choose, key, clip, count]);
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

/** A setup's environment types with a preview (Ego-centric unless named). Empty while previews are switched off. */
export function usePreviewSlugs(setup: SetupId = "ego"): readonly string[] {
  const mine = useContext(PreviewContext).counts[setup];
  return useMemo(() => Object.keys(mine).filter((s) => mine[s] > 0), [mine]);
}

const Chevron = ({ dir }: { dir: "prev" | "next" }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-3.5 w-3.5 lg:h-4 lg:w-4">
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
  dotsClassName = "",
}: {
  name: string;
  clip: number;
  count: number;
  onStep: (by: number) => void;
  /** Extra classes for the buttons and dots, e.g. to show them only on hover. */
  className?: string;
  /** Where the dots sit, clear of whatever else is on the picture. */
  dotsAt?: string;
  /** Extra classes for the dots only. */
  dotsClassName?: string;
}) {
  if (count < 2) return null;
  // Small and see-through, so they sit on the picture without hiding it: 24px on phones (the minimum
  // target), 32px on desktop. Solid on hover.
  const button = `pointer-events-auto flex h-6 w-6 items-center justify-center rounded-full bg-white/55 text-ink shadow-[0_1px_4px_rgba(0,0,0,0.25)] backdrop-blur-[3px] transition-[opacity,background-color,transform,translate,scale] duration-150 hover:bg-white/90 active:scale-90 lg:h-8 lg:w-8 ${className}`;
  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 top-1/2 z-20 flex -translate-y-1/2 items-center justify-between px-1 lg:px-2">
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
        className={`pointer-events-none absolute ${dotsAt} left-1/2 z-20 flex -translate-x-1/2 items-center gap-[3px] rounded-full bg-black/40 px-1 py-[3px] transition-opacity duration-150 lg:gap-1 lg:px-1.5 lg:py-1 ${className} ${dotsClassName}`}
      >
        {Array.from({ length: count }, (_, i) => (
          <span
            key={i}
            className={`h-1 rounded-full transition-[width,background-color] duration-200 lg:h-1.5 ${i + 1 === clip ? "w-2.5 bg-white lg:w-3" : "w-1 bg-white/55 lg:w-1.5"}`}
          />
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

/** The views in each setup's frame and where each sits, for its name and watermark. */
const EGO_VIEWS = [
  { name: "L · Left eye", at: "inset-y-0 left-0 w-1/2" },
  { name: "R · Right eye", at: "inset-y-0 right-0 w-1/2" },
];
const HEAD_WRIST_VIEWS = [
  { name: "Head · L", at: "top-0 left-0 h-1/2 w-1/2" },
  { name: "Head · R", at: "top-0 right-0 h-1/2 w-1/2" },
  { name: "Left wrist", at: "bottom-0 left-0 h-1/2 w-1/2" },
  { name: "Right wrist", at: "right-0 bottom-0 h-1/2 w-1/2" },
];

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
  setup = "ego",
  className = "",
  autoPlay = false,
  startAt = 0,
}: {
  slug: string;
  /** Which capture setup's clips: Ego-centric (one stereo frame) or head + wrist (head on top, wrists below). */
  setup?: SetupId;
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
  const hw = setup === "head_wrist";
  const { clip, count, step } = useClips(slug, setup);
  // startAt belongs to the clip that was showing when this player opened (where a hover had got to).
  const firstClip = useRef(clip);
  const from = clip === firstClip.current ? startAt : 0;
  const src = `${clipSrc(slug, clip, setup)}#t=${from > 0.1 ? from.toFixed(2) : "0.1"}`;
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
  const views = hw ? HEAD_WRIST_VIEWS : EGO_VIEWS;
  // In full screen the picture is centred and as large as fits (width-limited when upright, height-limited when wide).
  const picture = full
    ? `absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 ${hw ? "aspect-[16/10] w-[min(100%,160vh)]" : "aspect-[16/5] w-[min(100%,320vh)]"}`
    : "absolute inset-0";

  return (
    <div
      ref={wrapRef}
      onPointerEnter={(e) => e.pointerType === "mouse" && reveal()}
      onPointerMove={(e) => e.pointerType === "mouse" && reveal(full ? 2500 : undefined)}
      onPointerLeave={(e) => e.pointerType === "mouse" && setHover(false)}
      onPointerDown={(e) => e.pointerType !== "mouse" && reveal(3000)}
      // A size container: labels, watermark and the picture's shape follow the player's own width
      // (a phone, the step 2 card, the dialog, full screen), not the screen's.
      // isolate: the player is its own layer, so its controls (z-10 / z-20) never draw over the page's sticky bar.
      className={`group @container relative isolate overflow-hidden bg-[#0b1220] ${full ? "flex items-center justify-center" : "rounded-lg"} ${className}`}
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
        aria-label={`${domainName(slug)} ${hw ? "head and wrist " : ""}preview`}
        // Ego-centric on narrow players (phones): a little taller than the clip's 16:5, trimming each
        // eye's outer edges equally so the picture isn't a thin strip; from 448px wide the whole frame
        // shows. Head + wrist is 16:10 already and always shows whole.
        className={`block w-full cursor-pointer bg-[#0b1220] ${
          full ? "h-full object-contain" : hw ? "aspect-[16/10] object-contain" : "aspect-[16/6] object-cover @md:aspect-[16/5] @md:object-contain"
        }`}
      />

      {/* Everything drawn on the picture sits in this box: the player itself, or in full screen the
          picture's own rectangle (centred, as large as fits), so it stays on the picture on any screen. */}
      <div className={`pointer-events-none ${picture}`}>
        {/* The views in the frame: their dividing lines and names (with the controls), and the
            watermark in each view's top-right corner (always). Drawn over the picture, not into it. */}
        {!failed && (
          <>
            <div aria-hidden="true" className={`absolute inset-0 ${fade}`}>
              <span className="absolute inset-y-0 left-1/2 w-px bg-white/25" />
              {hw && <span className="absolute inset-x-0 top-1/2 h-px bg-white/25" />}
            </div>
            {views.map((v) => (
              <div key={v.name} aria-hidden="true" className={`absolute z-10 select-none ${v.at}`}>
                <EyeLabel className={`left-1.5 @md:left-3 ${fade}`}>{v.name}</EyeLabel>
                <Watermark full={full} className="right-1.5 @md:right-2.5" />
              </div>
            ))}
          </>
        )}

        {/* Other clips of this type. Arrows always shown (a tap has no hover). The dots sit at the bottom
            edge, clear of the labels and the play button, and step aside while the control bar is up. */}
        <ClipArrows
          name={domainName(slug)}
          clip={clip}
          count={count}
          dotsAt="bottom-1.5 @md:bottom-2"
          dotsClassName={shown ? "opacity-0" : ""}
          onStep={(by) => {
            playNext.current = true;
            slideClip(ref.current, by);
            step(by);
          }}
        />
      </div>

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
            className={`absolute top-1/2 left-1/2 z-20 ${waiting && playing ? "opacity-100" : `${fade} ${clickable}`} flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-ink shadow-lg transition-transform duration-150 hover:scale-105 active:scale-95 @md:h-14 @md:w-14 lg:h-16 lg:w-16`}
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
      // Sized to the player: small and tucked into each eye's top-right corner on a phone.
      className={`absolute flex items-center font-semibold tracking-[0.02em] text-white opacity-60 [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.6))] ${
        // Full screen too follows the width: a phone held upright is still a narrow picture.
        `top-1.5 gap-1 text-[9px] @md:top-2.5 @md:gap-1.5 @md:text-[12px] @xl:text-[14px] ${full ? "@3xl:top-5 @3xl:gap-2.5 @3xl:text-[24px]" : ""}`
      } ${className}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/images/awign-mark.png" alt="" width={63} height={63} className={`w-auto brightness-0 invert h-2.5 @md:h-3.5 @xl:h-4 ${full ? "@3xl:h-7" : ""}`} />
      Awign
    </span>
  );
}

function EyeLabel({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span
      className={`absolute top-1.5 rounded bg-black/55 px-1 py-0.5 font-mono text-[8px] tracking-[0.1em] text-white uppercase @md:top-3 @md:px-2 @md:py-1 @md:text-[10px] @md:tracking-[0.14em] @xl:text-[11px] ${className}`}
    >
      {children}
    </span>
  );
}

/**
 * Step 2's preview card: the picked environment types that have a clip, one at a
 * time, with chips to jump and Previous / Next to step through them.
 */
export function StepPreview({ picked, setup }: { picked: string[]; setup: SetupId }) {
  const available = usePreviewSlugs(setup);
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
      <PreviewVideo key={`${setup}:${current}`} slug={current} setup={setup} className="-mx-3 mt-3" />
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
