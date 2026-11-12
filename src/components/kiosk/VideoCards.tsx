"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SETUP_BY_ID, SKILLS, type Domain, type SetupId } from "@/lib/catalog";
import { hoursBy } from "@/lib/inventory";
import { stagger } from "@/lib/motion";
import { formatHours, formatHoursFine } from "@/lib/selection";
import { Photo } from "../Photo";
import { useInventory } from "./InventoryContext";
import { ClipArrows, PreviewVideo, clipSrc, slideClip, useClips } from "./Preview";
import { CheckIcon } from "./ui";

// Step 2: environment cards as video thumbnails. The photo is the thumbnail; resting the
// mouse on it plays that environment's preview in place, and a click opens the full preview in
// a dialog that grows out of the card. Cards without a clip pick on click.

/** How long the mouse rests on a card before its video starts, so sweeping across the grid loads nothing. */
const HOVER_DELAY_MS = 300;

/** Window event a card sends when its arrows start it playing, so any other card stops. */
const CARD_PLAY = "ots:card-play";

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Where the card's thumbnail is now, measured when the dialog opens and again when it closes. */
export type Origin = () => DOMRect | null;

export function VideoCard({
  domain,
  index,
  hours,
  episodes,
  setup,
  hasClip,
  selected,
  disabled,
  paused,
  onToggle,
  onOpen,
}: {
  domain: Domain;
  index: number;
  hours: number;
  episodes: number;
  /** The chosen capture setup: whose clips the card plays. */
  setup: SetupId;
  /** This environment type has a preview clip for the chosen setup. */
  hasClip: boolean;
  selected: boolean;
  /** Nothing recorded here for this setup. */
  disabled: boolean;
  /** A dialog is open over the grid: stop the hover video. */
  paused: boolean;
  onToggle: () => void;
  onOpen: (origin: Origin, startAt: number) => void;
}) {
  const thumbRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hover, setHover] = useState(false);
  // Started by the card's own arrows: plays without a hover (a tap on a phone), until the mouse leaves.
  const [forced, setForced] = useState(false);
  const [live, setLive] = useState(false);
  const [progress, setProgress] = useState(0);
  const { clip, count, step } = useClips(domain.slug, setup);
  const play = hasClip && (hover || forced) && !paused;

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  useEffect(() => {
    if (!play) {
      setLive(false);
      setProgress(0);
    }
  }, [play]);
  // The same video element takes the next clip (so it can slide in, see slideClip); only the progress restarts.
  useEffect(() => setProgress(0), [clip]);
  // One card plays from its arrows at a time: starting one stops the others.
  useEffect(() => {
    const stop = (e: Event) => (e as CustomEvent<string>).detail !== domain.slug && setForced(false);
    window.addEventListener(CARD_PLAY, stop);
    return () => window.removeEventListener(CARD_PLAY, stop);
  }, [domain.slug]);

  const stepClip = (by: number) => {
    // Playing already (a hover): slide to the next clip. Not yet (a first tap on a phone): it fades in as on hover.
    if (live) slideClip(videoRef.current, by);
    step(by);
    setForced(true);
    window.dispatchEvent(new CustomEvent(CARD_PLAY, { detail: domain.slug }));
  };

  const enter = (e: React.PointerEvent) => {
    // Mouse only: a touch has no hover, a tap opens the dialog. Reduced motion: nothing starts on its own.
    if (e.pointerType !== "mouse" || !hasClip || reducedMotion()) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setHover(true), HOVER_DELAY_MS);
  };
  const leave = (e: React.PointerEvent) => {
    if (timer.current) clearTimeout(timer.current);
    setHover(false);
    if (e.pointerType === "mouse") setForced(false);
  };
  const open = () => {
    const v = videoRef.current;
    onOpen(() => thumbRef.current?.getBoundingClientRect() ?? null, live && v ? v.currentTime : 0);
  };

  return (
    // isolate: the card is its own layer, so the arrows, dots and check on it stay inside it and
    // never draw over the page's sticky bottom bar or anything else above the grid.
    <div className="group/card relative isolate animate-fade-up" style={stagger(index, 100)} onPointerEnter={enter} onPointerLeave={leave}>
      <button
        type="button"
        onClick={hasClip ? open : onToggle}
        // With a clip the card opens the preview and the round button picks it; without one the card picks, as on "/".
        aria-haspopup={hasClip ? "dialog" : undefined}
        aria-pressed={hasClip ? undefined : selected}
        aria-label={hasClip ? `Preview ${domain.name}` : undefined}
        disabled={!hasClip && disabled && !selected}
        className="block w-full rounded-[14px] text-left outline-offset-4 transition-[transform,translate,scale] duration-200 enabled:active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <div
          ref={thumbRef}
          className={`relative aspect-[16/10] overflow-hidden rounded-xl bg-[#0b1220] transition-shadow duration-200 lg:rounded-[14px] ${
            selected ? "ring-[2.5px] ring-brand ring-offset-2" : ""
          }`}
        >
          <Photo src={domain.image} alt="" className="absolute inset-0 h-full w-full" imgClassName={live ? "" : "group-hover/card:scale-[1.04]"} />
          {play && (
            <video
              ref={videoRef}
              // The clip holds both eyes side by side (16:5); covering a 16:10 box from the left shows exactly the left eye.
              src={clipSrc(domain.slug, clip, setup)}
              muted
              autoPlay
              loop
              playsInline
              preload="auto"
              disablePictureInPicture
              onContextMenu={(e) => e.preventDefault()}
              onPlaying={() => setLive(true)}
              onTimeUpdate={(e) => {
                const v = e.currentTarget;
                if (v.duration) setProgress(v.currentTime / v.duration);
              }}
              aria-hidden="true"
              // Dark behind the picture: while the next clip loads it slides in as a dark panel, not see-through to the photo.
              // Head + wrist is 16:10 like the card, so it shows whole: head on top, both wrists below.
              className={`absolute inset-0 h-full w-full bg-[#0b1220] object-cover ${setup === "ego" ? "object-left" : "object-center"} transition-opacity duration-300 ${live ? "opacity-100" : "opacity-0"}`}
            />
          )}
          {hasClip && !live && (
            <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-white lg:bottom-2.5 lg:left-2.5 lg:px-2 lg:py-1 lg:text-[12px]">
              <svg width="9" height="9" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z" fill="currentColor" />
              </svg>
              Preview
            </span>
          )}
          {play && !live && <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[3px] animate-pulse bg-white/40" />}
          {live && (
            <>
              <span
                aria-hidden="true"
                className="pointer-events-none absolute right-2.5 bottom-3 flex items-center gap-1 text-[11px] font-semibold text-white opacity-60 [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.6))] lg:text-[12px]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/images/awign-mark.png" alt="" width={63} height={63} className="h-3 w-auto brightness-0 invert" />
                Awign
              </span>
              <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[3px] bg-white/25">
                <span className="block h-full bg-brand" style={{ width: `${progress * 100}%` }} />
              </span>
            </>
          )}
        </div>
        <div className="px-0.5 pt-2.5 pb-1 lg:pt-3">
          <p className="text-[15px] leading-snug font-semibold lg:text-[19px]">{domain.name}</p>
          <p className="tabular mt-0.5 text-[12px] text-muted lg:text-[15px]">
            <span className="font-semibold text-brand">{formatHoursFine(hours)} h</span> · {formatHours(episodes)} episodes
          </p>
        </div>
      </button>

      {/* Other clips of this type, over the thumbnail (outside the card's button: a button can't hold buttons).
          Shown on hover or keyboard focus; always on touch screens, which have no hover. */}
      {hasClip && count > 1 && (
        <div className="pointer-events-none absolute inset-x-0 top-0 aspect-[16/10]">
          <ClipArrows
            name={domain.name}
            clip={clip}
            count={count}
            onStep={stepClip}
            className="opacity-0 group-hover/card:opacity-100 group-has-[:focus-visible]/card:opacity-100 [@media(hover:none)]:opacity-100"
          />
        </div>
      )}

      {hasClip ? (
        <button
          type="button"
          aria-pressed={selected}
          aria-label={`${selected ? "Remove" : "Add"} ${domain.name}`}
          title={selected ? "Remove from selection" : "Add to selection"}
          disabled={disabled && !selected}
          onClick={onToggle}
          className="absolute top-0 right-0 flex h-12 w-12 items-center justify-center rounded-full disabled:cursor-not-allowed lg:h-14 lg:w-14"
        >
          <span
            className={`flex h-7 w-7 items-center justify-center rounded-full border-2 transition-colors duration-150 lg:h-8 lg:w-8 ${
              selected ? "animate-pop border-brand bg-brand text-white" : "border-white bg-black/35 text-white/0 backdrop-blur-[2px] hover:text-white/90"
            }`}
          >
            <CheckIcon className="h-3.5 w-3.5 lg:h-4 lg:w-4" />
          </span>
        </button>
      ) : (
        selected && (
          <span className="pointer-events-none absolute top-2.5 right-2.5 flex h-7 w-7 animate-pop items-center justify-center rounded-full bg-brand text-white lg:h-8 lg:w-8">
            <CheckIcon className="h-3.5 w-3.5 lg:h-4 lg:w-4" />
          </span>
        )
      )}
    </div>
  );
}

/**
 * The full preview of one environment type: the stereo player (both eyes, controls, full
 * screen), what was recorded there, and the pick. Opens from the card's thumbnail and shrinks
 * back into it on close; with reduced motion it only fades.
 */
export function PreviewDialog({
  domain,
  setup,
  hours,
  episodes,
  selected,
  disabled,
  origin,
  startAt,
  onToggle,
  onClose,
}: {
  domain: Domain;
  setup: SetupId;
  hours: number;
  episodes: number;
  selected: boolean;
  disabled: boolean;
  origin: Origin;
  startAt: number;
  onToggle: () => void;
  onClose: () => void;
}) {
  const inv = useInventory();
  const panelRef = useRef<HTMLDivElement>(null);
  const videoBoxRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const closing = useRef(false);

  const skillHours = hoursBy(inv, "skill", { setup, domains: [domain.slug] });
  const skills = SKILLS.filter((s) => (skillHours[s.slug] ?? 0) > 0).sort((a, b) => (skillHours[b.slug] ?? 0) - (skillHours[a.slug] ?? 0));

  /** The transform that puts the panel's video where the card's thumbnail is (uniform scale, so nothing stretches). */
  const fromCard = (): string | null => {
    const from = origin();
    const panel = panelRef.current?.getBoundingClientRect();
    const box = videoBoxRef.current?.getBoundingClientRect();
    if (!from || !panel || !box || !box.width || reducedMotion()) return null;
    const s = from.width / box.width;
    const dx = from.left - panel.left - s * (box.left - panel.left);
    const dy = from.top + from.height / 2 - panel.top - s * (box.top + box.height / 2 - panel.top);
    return `translate(${dx}px, ${dy}px) scale(${s})`;
  };

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const fade = backdropRef.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: "ease-out" });
    if (!panel) return () => fade?.cancel();
    const t = fromCard();
    const grow = panel.animate(
      t
        ? [
            { transform: t, opacity: 0 },
            { opacity: 1, offset: 0.3 },
            { transform: "none", opacity: 1 },
          ]
        : [{ opacity: 0 }, { opacity: 1 }],
      { duration: t ? 480 : 200, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
    // A re-run (React's dev double effects, a remount) must measure the panel where it really is,
    // not mid-animation, or the second run computes "no movement" and the open looks instant.
    return () => {
      fade?.cancel();
      grow.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = () => {
    if (closing.current) return;
    closing.current = true;
    const panel = panelRef.current;
    if (!panel) return onClose();
    const t = fromCard();
    backdropRef.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 280, easing: "ease-in", fill: "forwards" });
    const a = panel.animate(
      t
        ? [
            { transform: "none", opacity: 1 },
            { opacity: 1, offset: 0.6 },
            { transform: t, opacity: 0 },
          ]
        : [{ opacity: 1 }, { opacity: 0 }],
      { duration: t ? 320 : 160, easing: "cubic-bezier(0.4, 0, 0.6, 1)", fill: "forwards" },
    );
    a.finished.then(onClose, onClose);
  };
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>("[data-autofocus]")?.focus({ preventScroll: true });
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      // Esc first leaves the player's full screen (the browser handles that), then closes.
      if (e.key === "Escape" && !document.fullscreenElement) {
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const items = panel.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled])");
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      opener?.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(
    <div
      className="fixed inset-0 z-40 flex items-end justify-center lg:items-center lg:p-8"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div ref={backdropRef} aria-hidden="true" className="pointer-events-none absolute inset-0 bg-ink/45 backdrop-blur-[3px]" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="env-preview-title"
        style={{ transformOrigin: "0 0" }}
        className="relative flex max-h-[92dvh] w-full flex-col overflow-y-auto rounded-t-3xl bg-white shadow-[0_30px_80px_-30px_rgba(11,18,32,0.55)] lg:w-[min(1100px,100%)] lg:rounded-[24px]"
      >
        <div className="flex items-start justify-between gap-4 px-5 pt-5 lg:px-8 lg:pt-7">
          <div className="min-w-0">
            <p className="font-mono text-[11px] tracking-[0.18em] text-brand uppercase lg:text-[12px]">Preview · {SETUP_BY_ID[setup].name}</p>
            <h2 id="env-preview-title" className="mt-1.5 text-[22px] leading-tight font-semibold tracking-tight lg:text-[32px] lg:font-medium">
              {domain.name}
            </h2>
          </div>
          <button
            type="button"
            data-autofocus
            onClick={close}
            aria-label="Close preview"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface text-ink transition-[background-color,transform,translate,scale] duration-200 hover:bg-line active:scale-95 lg:h-12 lg:w-12"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div ref={videoBoxRef} className="mt-4 px-3 lg:mt-5 lg:px-5">
          <PreviewVideo slug={domain.slug} setup={setup} autoPlay startAt={startAt} />
        </div>

        <div className="flex flex-col gap-4 px-5 pt-4 pb-5 lg:flex-row lg:items-start lg:justify-between lg:gap-10 lg:px-8 lg:pt-6 lg:pb-8">
          <div className="min-w-0">
            <p className="tabular text-[15px] text-muted lg:text-[17px]">
              <span className="text-[18px] font-semibold text-brand lg:text-[22px]">{formatHoursFine(hours)} h</span>
              {" · "}
              {formatHours(episodes)} episodes · {skills.length} skill{skills.length === 1 ? "" : "s"}
            </p>
            {skills.length > 0 && (
              <ul aria-label={`Skills recorded in ${domain.name}`} className="mt-3 flex flex-wrap gap-1.5 lg:gap-2">
                {skills.map((s) => (
                  <li key={s.slug} className="rounded-lg bg-surface px-2.5 py-1 text-[13px] lg:text-[14px]">
                    {s.short}
                    <span className="tabular ml-1.5 text-muted">{formatHoursFine(skillHours[s.slug] ?? 0)} h</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button
            type="button"
            disabled={disabled && !selected}
            onClick={() => {
              onToggle();
              close();
            }}
            className={`inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-full px-6 text-[16px] font-semibold transition-[background-color,transform,translate,scale] duration-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 lg:h-14 lg:px-8 lg:text-[18px] ${
              selected ? "border border-line bg-white text-ink hover:bg-surface" : "bg-brand text-white hover:bg-brand-hover"
            }`}
          >
            {selected ? (
              "Remove from selection"
            ) : (
              <>
                <CheckIcon className="h-4 w-4" /> Add to selection
              </>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
