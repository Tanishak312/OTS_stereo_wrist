"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { submitRequest } from "@/app/actions";
import { DATASET, SETUP_BY_ID } from "@/lib/catalog";
import {
  EMPTY_CONTACT,
  EMPTY_SELECTION,
  environmentsShort,
  matchingHours,
  skillsNarrowed,
  type Contact,
  type RequestKind,
  type Selection,
} from "@/lib/selection";
import { Logo } from "../Logo";
import { CONTACT_FORM_ID, ContactStep, submitLabel } from "./ContactStep";
import { Landing } from "./Landing";
import { EnvironmentsStep, ReviewStep, SetupStep, TasksStep } from "./Steps";
import { Success } from "./Success";
import { PreviewTabProvider } from "./Preview";
import { useInventory } from "./InventoryContext";
import { ArrowRight, BottomBar, CONTAINER, PrimaryButton, Progress, RestartIcon, SecondaryButton } from "./ui";

type Screen =
  | "landing"
  | "setup"
  | "environments"
  | "tasks"
  | "review"
  | "contact-dataset"
  | "contact-sample"
  | "done-dataset"
  | "done-sample";

const STEP_OF: Partial<Record<Screen, [number, string]>> = {
  setup: [1, "Capture setup"],
  environments: [2, "Environments"],
  tasks: [3, "Tasks"],
  review: [4, "Review"],
  "contact-dataset": [5, "Your details"],
  "contact-sample": [5, "Your details"],
};

// A booth kiosk is shared: wipe the previous visitor's details after a pause.
const IDLE_MS = 90_000;
const IDLE_WARNING_S = 20;

/** "v2" is the version under review at /v2: step 2 shows the environment types as video thumbnails. */
export function Kiosk({ variant = "v1" }: { variant?: "v1" | "v2" }) {
  const [history, setHistory] = useState<Screen[]>(["landing"]);
  const [sel, setSel] = useState<Selection>(EMPTY_SELECTION);
  const [contact, setContact] = useState<Contact>(EMPTY_CONTACT);
  const [tokens, setTokens] = useState<Partial<Record<RequestKind, string>>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  // The environment type shown in the preview card, kept the same from step 2 to step 4.
  const [previewTab, setPreviewTab] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Which way the last navigation went, so the next screen slides in from the matching side.
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const mainRef = useRef<HTMLElement>(null);
  const inv = useInventory();

  const screen = history[history.length - 1];

  const go = useCallback((next: Screen) => {
    setSubmitError(null);
    setDirection("forward");
    setHistory((h) => [...h, next]);
  }, []);

  const back = useCallback(() => {
    setSubmitError(null);
    setDirection("back");
    setHistory((h) => (h.length > 1 ? h.slice(0, -1) : h));
  }, []);

  const reset = useCallback(() => {
    setDirection("forward");
    setHistory(["landing"]);
    setSel(EMPTY_SELECTION);
    setContact(EMPTY_CONTACT);
    setPreviewTab(null);
    setTokens({});
    setSubmitError(null);
  }, []);

  // Start each screen at the top, and move focus to it for screen readers.
  useEffect(() => {
    window.scrollTo({ top: 0 });
    mainRef.current?.focus({ preventScroll: true });
  }, [screen]);

  const idle = useIdleReset(screen !== "landing", reset);

  function submit(kind: RequestKind) {
    setSubmitError(null);
    startTransition(async () => {
      const res = await submitRequest({ ...sel, ...contact, kind });
      if (res.ok) {
        setTokens((t) => ({ ...t, [kind]: res.token }));
        setDirection("forward");
        // Replace the form in history so Back from success doesn't resubmit.
        setHistory((h) => [...h.slice(0, -1), kind === "dataset" ? "done-dataset" : "done-sample"]);
      } else {
        setSubmitError(res.error);
      }
    });
  }

  if (screen === "landing") return <Landing onStart={() => go("setup")} />;

  const step = STEP_OF[screen];
  const hours = matchingHours(sel, inv);
  const contactKind: RequestKind | null =
    screen === "contact-dataset" ? "dataset" : screen === "contact-sample" ? "sample" : null;
  const summary = sel.setup
    ? [
        SETUP_BY_ID[sel.setup].name,
        screen !== "setup" && sel.environments.length ? environmentsShort(sel) : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  return (
    <div className="kiosk flex min-h-dvh flex-col bg-white [--page-bg:#ffffff]">
      <header className="animate-fade-in lg:border-b lg:border-line">
        <div className={`${CONTAINER} pt-5 lg:grid lg:h-[88px] lg:grid-cols-[1fr_auto_1fr] lg:items-center lg:pt-0`}>
          <div className="flex items-center justify-between lg:contents">
            <Logo />
            <div className="flex items-center gap-5 lg:hidden">
              {step && <span className="eyebrow text-[0.65rem] text-ink">Step {step[0]} of 5</span>}
              <button type="button" onClick={reset} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-ink hover:underline">
                Start over
                <RestartIcon />
              </button>
            </div>
          </div>
          {step && (
            <div className="mt-4 lg:hidden">
              <Progress step={step[0]} />
            </div>
          )}

          <div className="hidden items-center gap-4 lg:flex">
            {step && (
              <>
                <span className="text-[16px] text-muted">
                  Step {step[0]} of 5 · {step[1]}
                </span>
                <Progress step={step[0]} compact />
              </>
            )}
          </div>
          <button
            type="button"
            onClick={reset}
            className="hidden h-10 items-center gap-2 justify-self-end rounded-full border border-line bg-white px-4 text-[16px] font-medium text-ink hover:bg-surface lg:inline-flex"
          >
            <RestartIcon className="h-[18px] w-[18px]" />
            Start over
          </button>
        </div>
      </header>

      <main
        ref={mainRef}
        tabIndex={-1}
        className={`${CONTAINER} flex-1 pt-5 pb-8 outline-none lg:pt-10 lg:pb-10`}
      >
        {/* Keyed by screen so each step plays its entrance; the header and progress stay put. */}
        <PreviewTabProvider value={[previewTab, setPreviewTab]}>
        <div key={screen} className={direction === "back" ? "animate-enter-back" : "animate-enter-forward"}>
        {screen === "setup" && <SetupStep sel={sel} onChange={setSel} />}
        {screen === "environments" && <EnvironmentsStep sel={sel} onChange={setSel} videoCards={variant === "v2"} />}
        {screen === "tasks" && <TasksStep sel={sel} onChange={setSel} />}
        {screen === "review" && <ReviewStep sel={sel} />}
        {contactKind && (
          <ContactStep
            kind={contactKind}
            sel={sel}
            contact={contact}
            onChange={setContact}
            onSubmit={() => submit(contactKind)}
            submitError={submitError}
            pending={pending}
          />
        )}
        {(screen === "done-dataset" || screen === "done-sample") && (
          <Success
            kind={screen === "done-dataset" ? "dataset" : "sample"}
            token={tokens[screen === "done-dataset" ? "dataset" : "sample"] ?? ""}
            email={contact.email.trim()}
            hours={DATASET.sampleHours}
            preparing={screen !== "done-dataset" && sel.setup === "head_wrist"}
            canUpsell={!tokens[screen === "done-dataset" ? "sample" : "dataset"]}
            onUpsell={() => go(screen === "done-dataset" ? "contact-sample" : "contact-dataset")}
            onHome={reset}
          />
        )}
        </div>
        </PreviewTabProvider>
      </main>

      {screen === "setup" && (
        <BottomBar summary={summary}>
          <SecondaryButton onClick={back}>Back</SecondaryButton>
          <PrimaryButton disabled={!sel.setup} onClick={() => go("environments")}>
            Continue <ArrowRight />
          </PrimaryButton>
        </BottomBar>
      )}
      {screen === "environments" && (
        <BottomBar summary={summary}>
          <SecondaryButton onClick={back}>Back</SecondaryButton>
          <PrimaryButton disabled={!sel.environments.length} onClick={() => go("tasks")}>
            {sel.environments.length ? (
              <>
                Continue <ArrowRight />
              </>
            ) : (
              "Pick an environment type"
            )}
          </PrimaryButton>
        </BottomBar>
      )}
      {screen === "tasks" && (
        <BottomBar summary={summary}>
          <SecondaryButton onClick={back}>Back</SecondaryButton>
          <PrimaryButton onClick={() => go("review")}>
            {skillsNarrowed(sel) || sel.difficulties.length ? "Continue" : "Use all skills"} <ArrowRight />
          </PrimaryButton>
        </BottomBar>
      )}
      {screen === "review" && (
        <BottomBar summary={summary}>
          <SecondaryButton onClick={back}>Back</SecondaryButton>
          <PrimaryButton disabled={hours <= 0} onClick={() => go("contact-dataset")}>
            Request this dataset <ArrowRight />
          </PrimaryButton>
        </BottomBar>
      )}
      {contactKind && (
        <BottomBar summary={summary}>
          <SecondaryButton onClick={back}>Back</SecondaryButton>
          <PrimaryButton type="submit" form={CONTACT_FORM_ID} disabled={pending}>
            {pending ? "Sending…" : submitLabel(contactKind)}
            {!pending && <ArrowRight />}
          </PrimaryButton>
        </BottomBar>
      )}

      {idle.warning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6" role="alertdialog" aria-modal="true" aria-labelledby="idle-title">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 text-center">
            <p id="idle-title" className="text-xl font-semibold">
              Still there?
            </p>
            <p className="mt-2 text-sm text-muted">
              We&rsquo;ll clear this screen for the next visitor in <span className="tabular font-semibold text-ink">{idle.secondsLeft}s</span>.
            </p>
            <button
              type="button"
              autoFocus
              onClick={idle.dismiss}
              className="mt-5 h-14 w-full rounded-full bg-brand text-base font-semibold text-white hover:bg-brand-hover"
            >
              I&rsquo;m still here
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function useIdleReset(active: boolean, onReset: () => void) {
  const [warning, setWarning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(IDLE_WARNING_S);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const arm = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setSecondsLeft(IDLE_WARNING_S);
      setWarning(true);
    }, IDLE_MS);
  }, []);

  useEffect(() => {
    if (!active) {
      if (timer.current) clearTimeout(timer.current);
      setWarning(false);
      return;
    }
    arm();
    const onActivity = () => {
      if (!warning) arm();
    };
    const events = ["pointerdown", "keydown", "scroll"] as const;
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    return () => {
      events.forEach((e) => window.removeEventListener(e, onActivity));
      if (timer.current) clearTimeout(timer.current);
    };
  }, [active, arm, warning]);

  useEffect(() => {
    if (!warning) return;
    if (secondsLeft <= 0) {
      setWarning(false);
      onReset();
      return;
    }
    const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [warning, secondsLeft, onReset]);

  return {
    warning,
    secondsLeft,
    dismiss: () => {
      setWarning(false);
      arm();
    },
  };
}
