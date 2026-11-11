"use client";

import { useRef, useState } from "react";
import { DATASET, SETUPS } from "@/lib/catalog";
import { hoursBy, totals, type Inventory } from "@/lib/inventory";
import { delay, stagger, useCountUp } from "@/lib/motion";
import { useFitHeight } from "@/lib/useFitHeight";
import { formatHours } from "@/lib/selection";
import { Logo } from "../Logo";
import { Photo } from "../Photo";
import { useInventory } from "./InventoryContext";
import { LandingDetails } from "./LandingDetails";
import { ArrowRight, CONTAINER } from "./ui";

const HERO_IMAGE = "/images/robot-hand.jpeg";
// Clean photo; the badge, title and arrow are live elements on top so they can animate.
const EXPLORE_IMAGE = "/images/hero-section-explore-dataset-2.jpeg";
// Mobile card is composed (photo + live badge, title, arrow), so it needs a clean photo.
const MOBILE_EXPLORE_IMAGE = "/images/explore-mobile.jpeg";

/** Headline numbers, from the episode index: only setups and domains that actually have recordings count. */
function headline(inv: Inventory) {
  const t = totals(inv);
  const setups = SETUPS.filter((s) => (hoursBy(inv, "setup")[s.id] ?? 0) > 0).length;
  const domains = Object.values(hoursBy(inv, "domain")).filter((h) => h > 0).length;
  return { hours: t.hours, episodes: t.episodes, setups, domains };
}

function Badge({ className = "" }: { className?: string }) {
  const h = headline(useInventory());
  return (
    <span
      // Phones get the short line on one row, and the tag can never run past the card's edge.
      className={`inline-flex max-w-[calc(100%-3rem)] items-center gap-1.5 rounded-md bg-[#d92d20] px-2 py-1 font-mono text-[10px] tracking-[0.08em] text-white uppercase md:max-w-none md:gap-2 md:px-3 md:py-1.5 md:text-[12px] md:tracking-[0.12em] ${className}`}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-white" aria-hidden="true" />
      <span>
        {formatHours(h.hours)} h
        <span className="hidden md:inline">{` · ${h.setups} setup${h.setups === 1 ? "" : "s"}`}</span>
        {` · ${h.domains} environment types`}
      </span>
    </span>
  );
}

/** How long the landing takes to fade out before the first step comes in. */
const LEAVE_MS = 280;

function Stat({ value, suffix = "", label, index, mobile }: { value: number; suffix?: string; label: string; index: number; mobile?: boolean }) {
  // Count up from zero on page load, staggered with the other stats.
  const n = useCountUp(value, { from: 0, duration: 1400, startDelay: 450 + index * 120 });
  return (
    <div className="animate-fade-up" style={stagger(index, 380)}>
      <dt className="sr-only">{label}</dt>
      <dd
        className={
          mobile
            ? "tabular text-[clamp(18px,6.2vw,25px)] leading-none font-normal tracking-[-0.02em] whitespace-nowrap md:text-[44px]"
            : "tabular text-[37px] leading-none font-light whitespace-nowrap"
        }
        aria-label={`${formatHours(value)}${suffix}`}
      >
        {formatHours(n)}
        {suffix}
      </dd>
      <dd className={mobile ? "mt-2 font-mono text-[12px] tracking-[0.18em] text-muted uppercase md:mt-3 md:text-[14px]" : "mt-4 font-mono text-[16px] tracking-[0.15em] text-muted uppercase"}>
        {label}
      </dd>
    </div>
  );
}

export function Landing({ onStart }: { onStart: () => void }) {
  const h = headline(useInventory());
  const STATS = [
    { value: h.hours, suffix: " h", label: "Usable footage" },
    { value: h.episodes, label: "Episodes" },
    { value: DATASET.operators, label: "Operators" },
  ];
  const [leaving, setLeaving] = useState(false);
  const fitOuter = useRef<HTMLDivElement>(null);
  const fitInner = useRef<HTMLDivElement>(null);
  const fit = useFitHeight(fitOuter, fitInner);

  function start() {
    if (leaving) return;
    setLeaving(true);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setTimeout(onStart, reduced ? 0 : LEAVE_MS);
  }

  return (
    <div className={`relative min-h-dvh overflow-hidden bg-white ${leaving ? "animate-leave" : ""}`}>
      {/* Mobile (390 frame) and tablet (md:, 834 frame): the tablet fills the width and centres the content vertically. */}
      <div className="bg-white text-ink lg:hidden">
        <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-5 pt-6 pb-10 md:max-w-none md:px-12 md:pt-10 md:pb-14">
          <div className="animate-fade-in">
            <Logo className="h-8 self-start md:h-10" />
          </div>
          <div className="mt-6 md:my-auto md:py-8">
            <p className="animate-fade-up font-mono text-[12px] tracking-[0.2em] text-[#1f6fe5] uppercase md:text-[14px]" style={delay(80)}>
              Off-the-shelf egocentric data
            </p>
            <h1
              className="mt-4 animate-fade-up text-[clamp(40px,13.3vw,52px)] leading-[1.04] font-normal tracking-[-0.03em] md:mt-6 md:text-[clamp(64px,8.6vw,84px)] md:leading-[1.02]"
              style={delay(160)}
            >
              {formatHours(h.hours)} hours of robot-ready data.
            </h1>
            <p className="mt-5 animate-fade-up text-[17px] leading-snug text-muted md:mt-6 md:text-[22px]" style={delay(240)}>
              Pre-recorded, QC&rsquo;d data across {h.domains} environment types.
            </p>

            <button
              type="button"
              onClick={start}
              className="group/btn relative mt-6 block h-[220px] w-full animate-rise-in overflow-hidden rounded-[22px] text-left text-white transition-transform duration-200 active:scale-[0.99] md:mt-10 md:h-auto md:aspect-[2.25/1] md:rounded-[28px]"
              style={delay(320)}
            >
              <Photo
                src={MOBILE_EXPLORE_IMAGE}
                alt="Operator wearing the head-mounted capture rig"
                tone="dark"
                className="absolute inset-0 h-full w-full"
                imgClassName="group-hover/btn:scale-[1.03]"
              />
              <span className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-transparent" aria-hidden="true" />
              <Badge className="absolute top-6 left-6 md:top-8 md:left-8" />
              <span className="absolute bottom-6 left-6 text-[22px] font-medium md:bottom-9 md:left-8 md:text-[30px]">Explore the dataset</span>
              <span className="absolute right-6 bottom-6 flex h-14 w-14 items-center justify-center rounded-full bg-brand md:right-8 md:bottom-8 md:h-[72px] md:w-[72px]">
                <ArrowRight className="h-6 w-6 md:h-7 md:w-7" />
              </span>
            </button>

            <dl className="mt-5 grid grid-cols-3 gap-4 border-t border-line pt-5 md:mt-10 md:pt-8">
              {STATS.map((s, i) => (
                <Stat key={s.label} {...s} index={i} mobile />
              ))}
            </dl>
          </div>
        </div>
      </div>

      {/* Desktop (1440 frame): white page with the same top bar as the steps */}
      <header className="hidden animate-fade-in border-b border-line lg:block">
        <div className={`${CONTAINER} flex h-[88px] items-center`}>
          <Logo />
        </div>
      </header>
      {/* The hero always fits the screen below the top bar, leaving a strip for the next section to show there's more
          below: on short screens it scales down as a whole instead of scrolling. It is laid out 1/fit wider before scaling, so it still spans the same width as the top bar
          (gutters stay aligned with the logo) and only the height shrinks. */}
      <div ref={fitOuter} className="hidden h-[calc(100dvh-145px)] overflow-hidden lg:block">
      <div className={CONTAINER}>
      <div
        ref={fitInner}
        className="flex origin-top-left flex-col pt-9 pb-9 text-ink"
        style={fit < 1 ? { width: `${100 / fit}%`, transform: `scale(${fit})` } : undefined}
      >
        <div className="grid grid-cols-2 items-stretch gap-16">
          <div>
            <p className="animate-fade-up font-mono text-[13px] tracking-[0.18em] text-[#1f6fe5] uppercase" style={delay(60)}>
              Off-the-shelf egocentric data
            </p>
            <h1 className="mt-5 animate-fade-up text-[56px] leading-[1.09] font-medium tracking-[-0.02em]" style={delay(140)}>
              {formatHours(h.hours)} hours of robot-ready data.
            </h1>
            <p className="mt-8 animate-fade-up text-[20px] text-muted" style={delay(220)}>
              Pre-recorded, QC&rsquo;d data across {h.domains} environment types.
            </p>
            <hr className="mt-6 origin-left animate-draw-x border-0 border-t-[3px] border-[#c9ced6]" style={delay(300)} />
            <dl className="mt-8 flex flex-wrap gap-x-14 gap-y-6">
              {STATS.map((s, i) => (
                <Stat key={s.label} {...s} index={i} />
              ))}
            </dl>
          </div>
          {/* Portrait photo (893x1600) with both hands in its lower part: the frame spans the full
              height of the text column and is focused on the point where the hands meet. */}
          <Photo
            src={HERO_IMAGE}
            alt="A gloved human hand and a robotic hand reaching to touch"
            tone="dark"
            className="h-full min-h-[300px] w-full animate-rise-in rounded-[26px]"
            imgClassName="object-[50%_72%]"
            style={delay(180)}
          />
        </div>

        <button
          type="button"
          onClick={start}
          className="group/btn relative isolate mt-10 block h-[288px] w-full animate-rise-in overflow-hidden rounded-[28px] text-left text-white transition-[transform,translate,scale,box-shadow] duration-500 ease-[var(--ease-out-expo)] hover:-translate-y-1 hover:shadow-[0_24px_48px_-24px_rgba(11,18,32,0.55)] active:translate-y-0 active:scale-[0.995]"
          style={delay(380)}
        >
          <Photo
            src={EXPLORE_IMAGE}
            alt="Hands assembling an engine part in a workshop"
            tone="dark"
            className="absolute inset-0 h-full w-full"
            imgClassName="object-[center_58%] group-hover/btn:scale-[1.03]"
          />
          {/* Darkens the bottom-left so the title reads on any photo. */}
          <span
            aria-hidden="true"
            className="absolute inset-0 bg-[linear-gradient(to_top,rgba(0,0,0,0.72),rgba(0,0,0,0.25)_55%,rgba(0,0,0,0.15))]"
          />
          <Badge className="absolute top-8 left-8" />
          <span className="absolute bottom-10 left-8 text-[32px] font-medium tracking-[-0.01em]">Explore the dataset</span>
          <span className="absolute right-8 bottom-8 flex h-[73px] w-[73px] items-center justify-center rounded-full bg-brand transition-[transform,translate,scale,background-color] duration-300 ease-[var(--ease-out-expo)] group-hover/btn:scale-105 group-hover/btn:bg-brand-hover">
            <ArrowRight className="h-7 w-7" />
          </span>
        </button>
      </div>
      </div>
      </div>

      <LandingDetails onStart={start} />
    </div>
  );
}
