"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { domainName } from "@/lib/catalog";

// Preview videos: one short clip per environment type, streamed by the server
// from /api/preview/<slug> (src/lib/preview.ts). The browser only ever knows that
// URL and which slugs have a clip; never where the videos are stored.

const PreviewContext = createContext<readonly string[]>([]);

export function PreviewProvider({ slugs, children }: { slugs: string[]; children: ReactNode }) {
  return <PreviewContext.Provider value={slugs}>{children}</PreviewContext.Provider>;
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
  return useContext(PreviewContext);
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
        src={`/api/preview/${encodeURIComponent(slug)}#t=${startAt > 0.1 ? startAt.toFixed(2) : "0.1"}`}
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
