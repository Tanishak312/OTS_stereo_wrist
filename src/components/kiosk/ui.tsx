"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

// Desktop sizes (lg:) are measured from the 1440-wide Figma frames; the base
// classes are the mobile layout until mobile/tablet frames arrive.

/** Page gutter shared by header, content and bottom bar: mobile 20 px, tablet (md) full width with 48 px, desktop (lg) 1440 max with 80 px. */
export const CONTAINER = "mx-auto w-full max-w-3xl px-5 md:max-w-none md:px-12 lg:max-w-[1440px] lg:px-20";

export function ArrowRight({ className = "" }: { className?: string }) {
  return (
    <svg className={`transition-transform duration-200 group-hover/btn:translate-x-1 ${className}`} width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CheckIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m5 12.5 4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function RestartIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PrimaryButton({
  children,
  disabled,
  onClick,
  type = "button",
  form,
  className = "",
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  type?: "button" | "submit";
  form?: string;
  className?: string;
}) {
  return (
    <button
      type={type}
      form={form}
      onClick={onClick}
      disabled={disabled}
      className={`group/btn inline-flex h-14 flex-1 items-center justify-center gap-2 rounded-full px-4 text-base font-semibold whitespace-nowrap lg:px-6 transition-[background-color,color,transform,translate,scale] duration-200 enabled:active:scale-[0.97]
        lg:h-[55px] lg:w-[264px] lg:flex-none lg:text-[18px]
        enabled:bg-brand enabled:text-white enabled:hover:bg-brand-hover
        disabled:cursor-not-allowed disabled:bg-[#ececec] disabled:text-subtle ${className}`}
    >
      {children}
    </button>
  );
}

export function SecondaryButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-14 min-w-24 shrink-0 items-center justify-center rounded-full border border-line bg-white px-5 text-base font-medium text-ink transition-[background-color,transform,translate,scale] duration-200 hover:bg-surface active:scale-[0.97]
        lg:h-[55px] lg:min-w-[107px] lg:border-2 lg:text-[18px]"
    >
      {children}
    </button>
  );
}

export function Chip({
  selected,
  onToggle,
  label,
  meta,
  disabled = false,
  compact = false,
}: {
  selected: boolean;
  onToggle: () => void;
  label: string;
  meta?: string;
  /** No recordings for this option under the current picks. */
  disabled?: boolean;
  /** The smaller size, for several rows of chips on one screen. */
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onToggle}
      disabled={disabled}
      className={`inline-flex h-11 items-center gap-2 rounded-full border px-[14px] text-[14px] transition-[background-color,border-color,color,transform,translate,scale] duration-200 enabled:active:scale-[0.96]
        disabled:cursor-not-allowed disabled:border-dashed disabled:text-subtle
        ${compact ? "lg:h-12 lg:gap-2 lg:px-[18px] lg:text-[16px]" : "lg:h-[70px] lg:gap-3 lg:border-[1.5px] lg:px-[23px] lg:text-[20px]"} ${
          selected ? "border-brand bg-brand-50 text-brand" : "border-line bg-white text-ink enabled:hover:border-subtle"
        }`}
    >
      {selected && <CheckIcon className="-ml-1 h-4 w-4 animate-pop lg:h-5 lg:w-5" />}
      <span className="whitespace-nowrap">{label}</span>
      {meta && (
        <span className={`tabular text-[13px] whitespace-nowrap ${compact ? "lg:text-[14px]" : "lg:text-[17px]"} ${selected ? "text-brand" : disabled ? "text-subtle" : "text-muted"}`}>{meta}</span>
      )}
    </button>
  );
}

export function Progress({ step, total = 5, compact = false }: { step: number; total?: number; compact?: boolean }) {
  // Start empty for one frame so the first fill animates in too.
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(step));
    return () => cancelAnimationFrame(raf);
  }, [step]);

  return (
    <div
      className="flex gap-1.5"
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={total}
      aria-valuenow={step}
      aria-label={`Step ${step} of ${total}`}
    >
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`overflow-hidden rounded-full bg-line ${compact ? "h-[5px] w-[45px]" : "h-1 flex-1"}`}>
          {/* Fills left-to-right when the step is reached; staggered so a jump of several steps reads in order. */}
          <span
            className={`block h-full origin-left rounded-full bg-brand transition-transform duration-500 ease-[var(--ease-out-expo)] ${
              i < shown ? "scale-x-100" : "scale-x-0"
            }`}
            style={{ transitionDelay: i < shown ? `${i * 40}ms` : "0ms" }}
          />
        </span>
      ))}
    </div>
  );
}

export function BottomBar({
  summary,
  children,
  className = "",
}: {
  summary?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`sticky bottom-0 z-10 border-t border-line bg-[var(--page-bg)] ${className}`}>
      <div className={`${CONTAINER} pt-3 pb-5 lg:flex lg:h-[97px] lg:items-center lg:justify-between lg:py-0`}>
        {summary !== undefined && (
          <p className="mb-3 flex items-baseline gap-3 text-sm lg:mb-0 lg:gap-4" aria-live="polite">
            <span className="eyebrow shrink-0 text-[0.62rem] whitespace-nowrap text-muted lg:font-sans lg:text-[13px] lg:tracking-[0.12em]">Your setup</span>
            <span className="font-medium text-ink lg:text-[18px] lg:font-normal">{summary ?? "Nothing selected yet"}</span>
          </p>
        )}
        <div className="flex gap-3 lg:gap-4">{children}</div>
      </div>
    </div>
  );
}

/** "Select all" for a group of options; once every available option is picked it clears them instead. */
export function SelectAllButton({ all, onClick, disabled }: { all: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="min-h-11 shrink-0 px-1 text-[15px] font-medium whitespace-nowrap text-brand enabled:hover:underline disabled:cursor-not-allowed disabled:text-subtle lg:min-h-0 lg:text-[17px] lg:font-semibold"
    >
      {all ? "Clear all" : "Select all"}
    </button>
  );
}

/** Mobile and desktop frames word the eyebrow differently. */
export function Eyebrow({ mobile, desktop }: { mobile: ReactNode; desktop?: ReactNode }) {
  return (
    <p className="eyebrow text-[12px] font-medium tracking-[0.2em] text-brand lg:font-sans lg:text-[13px] lg:font-semibold lg:tracking-[0.12em]">
      {desktop ? (
        <>
          <span className="lg:hidden">{mobile}</span>
          <span className="hidden lg:inline">{desktop}</span>
        </>
      ) : (
        mobile
      )}
    </p>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return (
    <h1
      className="mt-2 text-[36px] leading-[1.1] font-medium tracking-[-0.02em]
        lg:mt-4 lg:text-[44px] lg:leading-[1.18] lg:font-medium lg:tracking-[-0.01em]"
    >
      {children}
    </h1>
  );
}

/** Desktop: heading + selection on the left (4/11), which stays in view while the right (7/11) scrolls. Mobile: stacked. */
/** Bottom bar (97 px) plus the sticky column's 24 px top offset and a little air. */
const STICKY_ROOM = 97 + 24 + 16;

export function StepLayout({ left, right }: { left: ReactNode; right: ReactNode }) {
  // The left column stays put while the cards scroll, but only if it fits: a taller one
  // would hide its bottom (step 2's Previous / Next) behind the bottom bar, so it scrolls.
  const leftRef = useRef<HTMLDivElement>(null);
  const [fits, setFits] = useState(true);
  useLayoutEffect(() => {
    const el = leftRef.current;
    if (!el) return;
    const check = () => setFits(el.offsetHeight <= window.innerHeight - STICKY_ROOM);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    window.addEventListener("resize", check);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", check);
    };
  }, []);
  return (
    <div className="lg:grid lg:grid-cols-[5fr_7fr] lg:items-start lg:gap-16">
      <div ref={leftRef} className={`min-w-0 ${fits ? "lg:sticky lg:top-6" : ""}`}>
        {left}
      </div>
      <div className="mt-6 min-w-0 lg:mt-0">{right}</div>
    </div>
  );
}
