"use client";

import { delay, stagger } from "@/lib/motion";
import type { RequestKind } from "@/lib/selection";
import { ArrowRight, CheckIcon } from "./ui";

// Sizes follow the 390-wide mobile frames; lg: scales them up for desktop.

type Stage = { label: string; state: "done" | "next"; meta?: string; icon: "check" | "mail" };

const STAGES: Stage[] = [
  { label: "Request received", state: "done", meta: "Done", icon: "check" },
  { label: "Sent on email", state: "next", icon: "mail" },
];

const COPY: Record<RequestKind, { eyebrow: string; title: string }> = {
  dataset: { eyebrow: "Request received", title: "Your dataset request is in." },
  sample: { eyebrow: "Sample requested", title: "Your sample is on the way." },
};

export function Success({
  kind,
  token,
  email,
  hours,
  preparing,
  canUpsell,
  onUpsell,
  onHome,
}: {
  kind: RequestKind;
  token: string;
  email: string;
  hours: number;
  /** A head + wrist sample: nothing to send yet, only a note that it's being prepared. */
  preparing: boolean;
  canUpsell: boolean;
  onUpsell: () => void;
  onHome: () => void;
}) {
  const copy = COPY[kind];
  return (
    // Capped width so the timeline and the card below stay compact on desktop instead of stretching edge to edge.
    <div className="mx-auto flex w-full max-w-[600px] flex-col items-center pt-6 text-center lg:pt-2" aria-live="polite">
      {/* Halo, then the badge, then the tick. */}
      <div className="flex h-[65px] w-[65px] animate-pop items-center justify-center rounded-full bg-[#dcf7e4] lg:h-24 lg:w-24">
        <div
          className="flex h-10 w-10 animate-pop items-center justify-center rounded-full bg-success text-white ring-[3px] ring-white/80 lg:h-14 lg:w-14 lg:ring-4"
          style={delay(120)}
        >
          <CheckIcon className="h-[18px] w-[18px] animate-pop [animation-delay:280ms] lg:h-6 lg:w-6" />
        </div>
      </div>

      <p className="eyebrow mt-6 animate-fade-up text-[13px] tracking-[0.2em] text-success lg:text-[14px]" style={delay(260)}>
        {copy.eyebrow}
        {/* The token matters for a dataset request (the team quotes it back); a sample just arrives. */}
        {kind === "dataset" && token && (
          <>
            {" "}
            · <span className="tabular">{token}</span>
          </>
        )}
      </p>
      <h1 className="mt-4 animate-fade-up text-[26px] leading-[1.2] font-medium tracking-[-0.01em] lg:text-[36px]" style={delay(320)}>
        {preparing ? "We're preparing your sample." : kind === "sample" ? `Your ${hours}-hour sample is on the way.` : copy.title}
      </h1>
      <p className="mt-3 animate-fade-up text-[16px] text-muted lg:text-[18px]" style={delay(380)}>
        {kind === "dataset" ? (
          <>A confirmation is on its way to {email}. Your access details follow when the data is ready.</>
        ) : preparing ? (
          <>We&rsquo;ll share it with {email} by email as soon as it&rsquo;s ready.</>
        ) : (
          <>Google Drive link going to {email}</>
        )}
      </p>

      <ol className="mt-6 grid w-full animate-fade-up grid-cols-2 rounded-2xl bg-surface px-1 py-4 lg:mt-8 lg:py-6" style={delay(440)}>
        {STAGES.map((s, i) => (
          <li key={s.label} className="relative flex animate-fade-up flex-col items-center" style={stagger(i, 540)}>
            {i > 0 && (
              // Runs from the previous circle's edge to this circle's edge: a bar that keeps sliding
              // towards the next stage, ending in an arrow, so it reads as on its way.
              <span
                aria-hidden="true"
                className="absolute top-[23px] flex -translate-y-1/2 items-center lg:top-8"
                style={{ left: "calc(-50% + 34px)", right: "calc(50% + 34px)" }}
              >
                <span className="relative h-1 flex-1 overflow-hidden rounded-full bg-brand-100">
                  <span className="absolute inset-y-0 left-0 w-2/5 animate-slide-bar rounded-full bg-brand" />
                </span>
                <svg className="-ml-2 h-5 w-5 shrink-0 text-brand" viewBox="0 0 24 24" fill="none">
                  <path d="m9 5 7 7-7 7" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            )}
            <span
              className={`relative flex h-[46px] w-[46px] items-center justify-center rounded-full lg:h-16 lg:w-16 ${
                s.state === "done" ? "bg-success text-white" : "border border-line bg-white text-ink"
              }`}
            >
              <StageIcon icon={s.icon} />
            </span>
            <span className="mt-2.5 px-1 text-[15px] leading-tight text-ink lg:mt-3 lg:text-[16px]">{s.label}</span>
            {s.meta && <span className="eyebrow mt-1.5 text-[12px] tracking-[0.2em] text-success">{s.meta}</span>}
          </li>
        ))}
      </ol>

      <div className="mt-6 w-full animate-fade-up rounded-2xl border border-brand/70 bg-brand-50 px-5 py-3.5 lg:py-6" style={delay(740)}>
        {canUpsell ? (
          <>
            <span className="eyebrow rounded-sm bg-brand px-2 py-0.5 text-[12px] tracking-[0.2em] text-white">
              {kind === "dataset" ? "Free sample" : "Full dataset"}
            </span>
            <p className="mt-2 text-[16px] font-semibold lg:mt-3 lg:text-[18px]">{kind === "dataset" ? "Want a quick look first?" : "Need more hours?"}</p>
            <div className="mt-2.5 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 lg:mt-4">
              <button
                type="button"
                onClick={onUpsell}
                className="group/btn inline-flex h-11 items-center gap-2 rounded-full bg-brand px-5 text-[14px] font-medium text-white transition-[background-color,transform,translate,scale] duration-200 hover:bg-brand-hover active:scale-[0.97] lg:h-12 lg:px-6"
              >
                {kind === "dataset" ? `Get a free ${hours} h sample` : "Request this dataset"}
                <ArrowRight className="h-4 w-4" />
              </button>
              <button type="button" onClick={onHome} className="h-11 px-2 text-[14px] font-medium text-brand hover:underline">
                Back to home
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-[16px] font-semibold">You&rsquo;re all set.</p>
            <p className="mt-1 text-[14px] text-muted">Both your dataset and sample requests are with our team.</p>
            <button
              type="button"
              onClick={onHome}
              className="mt-3 h-11 rounded-full bg-brand px-6 text-[14px] font-medium text-white transition-[background-color,transform,translate,scale] duration-200 hover:bg-brand-hover active:scale-[0.97]"
            >
              Back to home
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function StageIcon({ icon }: { icon: Stage["icon"] }) {
  const cls = "h-5 w-5 lg:h-7 lg:w-7";
  if (icon === "check") return <CheckIcon className={cls} />;
  return (
    <svg className={cls} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="m4 7 8 6 8-6" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}
