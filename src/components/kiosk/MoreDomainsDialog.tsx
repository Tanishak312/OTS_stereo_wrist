"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { Domain } from "@/lib/catalog";
import { stagger } from "@/lib/motion";
import { formatHours, formatHoursFine } from "@/lib/selection";
import { ArrowRight, Chip } from "./ui";

/**
 * "More environments" panel for the domains past the first eight. Multi-select
 * chips write straight into the selection, so Done and Close both just close.
 */
export function MoreDomainsDialog({
  domains,
  hours,
  selected,
  onToggle,
  onClose,
}: {
  domains: Domain[];
  /** Hours per domain slug for the chosen setup (live). */
  hours: Record<string, number>;
  selected: string[];
  onToggle: (slug: string) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const totalHours = domains.reduce((acc, d) => acc + (hours[d.slug] ?? 0), 0);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>("[data-autofocus]")?.focus();

    // The page behind shouldn't scroll while the panel is open.
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      // Keep focus inside the panel.
      const items = panel.querySelectorAll<HTMLElement>("button:not([disabled])");
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
      opener?.focus();
    };
  }, [onClose]);

  const pickedHere = domains.filter((d) => selected.includes(d.slug)).length;

  // Portalled to <body> so a transformed ancestor (step entrance animation) can't trap the fixed overlay.
  return createPortal(
    <div
      className="fixed inset-0 z-40 flex animate-fade-in items-end justify-center bg-ink/25 backdrop-blur-[2px] lg:items-center lg:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="more-domains-title"
        className="flex max-h-[88dvh] w-full animate-rise-in flex-col rounded-t-3xl bg-white shadow-[0_30px_80px_-30px_rgba(11,18,32,0.45)] lg:max-h-[92dvh] lg:w-[675px] lg:rounded-[28px]"
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-6 lg:px-9 lg:pt-9">
          <div>
            <p className="eyebrow text-[0.65rem] text-brand lg:text-[14px] lg:tracking-[0.2em]">
              {domains.length} more · {formatHours(totalHours)} h
            </p>
            <h2 id="more-domains-title" className="mt-2 text-2xl font-semibold tracking-tight lg:text-[36px] lg:leading-tight lg:font-medium">
              More environment types
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface text-ink transition-[background-color,transform,translate,scale] duration-200 hover:bg-line active:scale-95 lg:h-[64px] lg:w-[64px]"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="mt-5 flex flex-wrap gap-2 overflow-y-auto px-6 pb-2 lg:mt-7 lg:gap-[14px] lg:px-9">
          {domains.map((d, i) => (
            <span key={d.slug} className="animate-fade-up" style={stagger(i, 120)}>
              <Chip
                label={d.short ?? d.name}
                meta={`${formatHoursFine(hours[d.slug] ?? 0)} h`}
                selected={selected.includes(d.slug)}
                disabled={!((hours[d.slug] ?? 0) > 0) && !selected.includes(d.slug)}
                onToggle={() => onToggle(d.slug)}
              />
            </span>
          ))}
        </div>

        <div className="px-6 pt-5 pb-6 lg:px-9 lg:pt-7 lg:pb-9">
          <button
            type="button"
            data-autofocus
            onClick={onClose}
            className="group/btn inline-flex h-14 w-full items-center justify-center gap-2 rounded-full bg-brand text-base font-semibold text-white transition-[background-color,transform,translate,scale] duration-200 hover:bg-brand-hover active:scale-[0.98] lg:h-[72px] lg:text-[22px] lg:font-medium"
          >
            Done{pickedHere ? ` · ${pickedHere} added` : ""} <ArrowRight className="lg:h-6 lg:w-6" />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
