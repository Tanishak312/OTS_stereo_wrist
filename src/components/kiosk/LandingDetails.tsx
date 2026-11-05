"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { DEVICES, FAQS, MCAP_CONTENTS, SKILLS, domainName, skillName } from "@/lib/catalog";
import { hoursBy, skillsPerDomain } from "@/lib/inventory";
import { stagger, useInView } from "@/lib/motion";
import { formatHours, formatHoursFine } from "@/lib/selection";
import { Logo } from "../Logo";
import { Photo } from "../Photo";
import { useInventory } from "./InventoryContext";
import { ArrowRight, CONTAINER } from "./ui";

const CTA_IMAGE = "/images/hero-section-explore-dataset-2.jpeg";
const EASE = "ease-[var(--ease-out-expo)]";

/** Plays an entrance the first time its content scrolls into view. Uses keyframes, so hover transitions inside stay free. */
function Reveal({
  children,
  className = "",
  style,
  animation = "animate-fade-up",
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  animation?: string;
}) {
  const [ref, seen] = useInView<HTMLDivElement>();
  return (
    <div ref={ref} className={`${seen ? animation : "opacity-0"} ${className}`} style={style}>
      {children}
    </div>
  );
}

/** Slides open and shut, so content never pops in. */
function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div
      aria-hidden={!open}
      className={`grid transition-[grid-template-rows,opacity] duration-500 ${EASE} ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

function Heading({ eyebrow, title, intro }: { eyebrow: string; title: string; intro?: string }) {
  return (
    <Reveal>
      <p className="font-mono text-[12px] tracking-[0.18em] text-[#1f6fe5] uppercase lg:text-[13px]">{eyebrow}</p>
      <h2 className="mt-3 text-[32px] leading-[1.12] font-semibold tracking-[-0.02em] lg:text-[50px]">{title}</h2>
      {intro && <p className="mt-3 max-w-[60ch] text-[16px] leading-relaxed text-muted lg:text-[18px]">{intro}</p>}
    </Reveal>
  );
}

/** The skills recorded in one environment, largest first. Uses the same short names as the skills step. */
function EnvironmentSkills({ domain, open, play }: { domain: string; open: boolean; play: boolean }) {
  const inv = useInventory();
  const hours = hoursBy(inv, "skill", { domains: [domain] });
  const total = Object.values(hours).reduce((a, b) => a + b, 0);
  const slugs = Object.keys(hours)
    .filter((s) => hours[s] > 0)
    .sort((a, b) => hours[b] - hours[a]);

  return (
    <Collapse open={open}>
      <div className="pt-2">
        <div className="rounded-2xl border border-line bg-white p-4 lg:p-5">
          <p className="flex flex-wrap items-baseline gap-x-3 text-[16px] font-semibold lg:text-[17px]">
            {domainName(domain)}
            <span className="tabular text-[14px] font-normal text-muted">
              {slugs.length} skill{slugs.length === 1 ? "" : "s"} · {formatHours(total)} h
            </span>
          </p>
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {slugs.map((s, i) => (
              <li
                key={s}
                className={`rounded-lg bg-surface px-3 py-1.5 text-[14px] ${open && play ? "animate-fade-up" : ""}`}
                style={stagger(i)}
              >
                {SKILLS.find((x) => x.slug === s)?.short ?? skillName(s)} <span className="tabular text-muted">{formatHoursFine(hours[s])} h</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Collapse>
  );
}

function Coverage({ environments, hours, skills }: { environments: string[]; hours: Record<string, number>; skills: Record<string, number> }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [listRef, seen] = useInView<HTMLUListElement>();
  const toggle = (d: string) => setPicked((p) => (p.includes(d) ? p.filter((x) => x !== d) : [...p, d]));

  return (
    <>
      {/* Phones stack the pills, so each one's skills open right under it; wider screens show them all below the pills. */}
      <ul ref={listRef} aria-label="Environments" className="mt-8 md:flex md:flex-wrap md:gap-2.5 lg:mt-10">
        {environments.map((d, i) => {
          const on = picked.includes(d);
          return (
            <li key={d} className="mb-2 md:contents">
              <button
                type="button"
                aria-pressed={on}
                onClick={() => toggle(d)}
                style={stagger(i)}
                className={`inline-flex min-h-11 flex-wrap items-baseline gap-x-2 rounded-full border px-4 py-2.5 text-left transition-[background-color,border-color,color,translate,scale,box-shadow] duration-300 ${EASE} hover:-translate-y-0.5 hover:shadow-[0_8px_18px_-10px_rgba(11,18,32,0.35)] active:translate-y-0 active:scale-[0.97] ${
                  seen ? "animate-fade-up" : "opacity-0"
                } ${on ? "border-brand bg-brand text-white hover:bg-brand-hover" : "border-line bg-white hover:border-brand"}`}
              >
                <span className="text-[14px] font-semibold">{domainName(d)}</span>
                <span className={`tabular text-[13px] font-medium transition-colors duration-300 ${on ? "text-white" : "text-brand"}`}>{formatHours(hours[d])} h</span>
                <span className={`tabular text-[12px] transition-colors duration-300 ${on ? "text-white/80" : "text-muted"}`}>
                  {skills[d]} skill{skills[d] === 1 ? "" : "s"}
                </span>
              </button>
              <div className="md:hidden">
                <EnvironmentSkills domain={d} open={on} play={seen} />
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mt-2 hidden md:block" aria-live="polite">
        <Collapse open={!environments.some((d) => picked.includes(d))}>
          <p className="pt-2 text-[15px] text-muted">Select an environment to see its skills.</p>
        </Collapse>
        {environments.map((d) => (
          <EnvironmentSkills key={d} domain={d} open={picked.includes(d)} play={seen} />
        ))}
      </div>
    </>
  );
}

function McapItem({ title, detail, index }: { title: string; detail: string; index: number }) {
  const [ref, seen] = useInView<HTMLLIElement>();
  return (
    <li ref={ref} className={`group ${seen ? "animate-fade-up" : "opacity-0"}`} style={stagger(index)}>
      <span aria-hidden="true" className={`block h-0.5 origin-left bg-ink ${seen ? "animate-draw-x" : ""}`} style={stagger(index)} />
      <p aria-hidden="true" className={`tabular mt-5 text-[34px] leading-none font-light text-[#1f6fe5] transition-[translate] duration-300 ${EASE} group-hover:translate-x-1 lg:text-[42px]`}>
        {String(index + 1).padStart(2, "0")}
      </p>
      <p className="mt-4 text-[17px] font-semibold lg:text-[19px]">{title}</p>
      <p className="mt-1.5 text-[15px] leading-snug text-muted">{detail}</p>
    </li>
  );
}

function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="space-y-2">
      {FAQS.map(([q, a], i) => {
        const isOpen = open === i;
        return (
          <Reveal key={q} style={stagger(i)} className="rounded-2xl bg-surface transition-colors duration-300 hover:bg-[#eceef2]">
            <button
              type="button"
              id={`faq-q-${i}`}
              aria-expanded={isOpen}
              aria-controls={`faq-a-${i}`}
              onClick={() => setOpen(isOpen ? null : i)}
              className="flex min-h-14 w-full items-center justify-between gap-6 rounded-2xl px-5 py-4 text-left text-[16px] font-medium lg:min-h-[62px] lg:px-6 lg:text-[17px]"
            >
              {q}
              <svg className={`shrink-0 transition-[rotate,color] duration-500 ${EASE} ${isOpen ? "rotate-45 text-brand" : "text-muted"}`} width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
            <div id={`faq-a-${i}`} role="region" aria-labelledby={`faq-q-${i}`}>
              <Collapse open={isOpen}>
                <p className="px-5 pb-4 text-[15px] leading-relaxed text-muted lg:px-6 lg:pb-5 lg:text-[16px]">{a}</p>
              </Collapse>
            </div>
          </Reveal>
        );
      })}
    </div>
  );
}

function ExploreCard({ totalHours, onStart }: { totalHours: number; onStart: () => void }) {
  const [ref, seen] = useInView<HTMLDivElement>();
  return (
    <div ref={ref} className={seen ? "animate-rise-in" : "opacity-0"}>
      {/* The whole card starts the flow, like the Explore card in the hero. */}
      <button
        type="button"
        onClick={onStart}
        className={`group/btn relative isolate flex w-full flex-col gap-6 overflow-hidden rounded-[22px] bg-night px-6 py-9 text-left text-white transition-[translate,scale,box-shadow] duration-500 ${EASE} hover:-translate-y-1 hover:shadow-[0_24px_48px_-24px_rgba(11,18,32,0.55)] active:translate-y-0 active:scale-[0.995] md:flex-row md:items-center md:justify-between lg:min-h-[185px] lg:rounded-[28px] lg:px-14`}
      >
        <Photo
          src={CTA_IMAGE}
          alt=""
          tone="dark"
          className={`absolute inset-0 -z-10 h-full w-full transition-[scale] duration-700 ${EASE} group-hover/btn:scale-[1.04]`}
          imgClassName={`object-[center_58%] ${seen ? "scale-100" : "scale-110"}`}
        />
        <span className="absolute inset-0 -z-10 bg-[linear-gradient(to_right,rgba(0,0,0,0.72),rgba(0,0,0,0.42))]" aria-hidden="true" />
        <span className="text-[26px] leading-tight font-semibold tracking-[-0.01em] lg:text-[38px]">{formatHours(totalHours)} hours, ready to explore.</span>
        <span
          className={`inline-flex h-14 flex-none items-center justify-center gap-2.5 self-start rounded-full bg-white px-8 text-[16px] font-medium text-brand transition-[background-color,color,scale] duration-300 ${EASE} group-hover/btn:scale-105 group-hover/btn:bg-brand group-hover/btn:text-white md:self-auto`}
        >
          Explore the dataset <ArrowRight />
        </span>
      </button>
    </div>
  );
}

/** Below the hero: what we record with, what's covered, what an MCAP holds, and how delivery works. */
export function LandingDetails({ onStart }: { onStart: () => void }) {
  const inv = useInventory();
  const hours = hoursBy(inv, "domain");
  const skills = skillsPerDomain(inv);
  const environments = Object.keys(hours)
    .filter((d) => hours[d] > 0)
    .sort((a, b) => hours[b] - hours[a]);
  const allSkills = new Set(inv.cells.filter((c) => c[5] > 0).map((c) => c[2])).size;

  return (
    <div className="bg-white text-ink">
      <section id="devices" className={`${CONTAINER} py-14 lg:pt-6 lg:pb-24`}>
        <Heading eyebrow="Capture devices" title="Two ways we record" />
        <div className="mt-8 space-y-12 lg:mt-12">
          {DEVICES.map((d, i) => (
            <article key={d.id} className="group grid gap-6 md:grid-cols-2 md:items-center md:gap-10 lg:gap-16">
              {/* The second device mirrors the first: text on the left, photo on the right. */}
              <Reveal animation="animate-rise-in" className={i % 2 ? "md:order-last" : ""}>
                <Photo
                  src={d.image}
                  alt={`${d.name} in use`}
                  className="aspect-[15/11] w-full rounded-[22px] lg:rounded-[28px]"
                  imgClassName="origin-bottom scale-[1.02] object-[50%_20%] group-hover:scale-[1.06]"
                />
              </Reveal>
              <Reveal style={stagger(2)}>
                <p className="tabular text-[44px] leading-none font-light text-[#1f6fe5] lg:text-[60px]">{String(i + 1).padStart(2, "0")}</p>
                <h3 className="mt-4 text-[26px] font-semibold tracking-[-0.01em] lg:mt-6 lg:text-[36px]">{d.name}</h3>
                <p className="mt-2 text-[15px] leading-snug text-muted lg:text-[17px]">{d.summary}</p>
                <dl className="mt-4 grid grid-cols-2 gap-x-6 lg:gap-x-8">
                  {d.specs.map(([label, value]) => (
                    <div key={label} className="border-t border-line py-3 lg:py-4">
                      <dt className="font-mono text-[11px] tracking-[0.12em] text-muted uppercase lg:text-[12px]">{label}</dt>
                      <dd className="mt-1 text-[14px] leading-snug font-semibold lg:text-[15px]">{value}</dd>
                    </div>
                  ))}
                </dl>
              </Reveal>
            </article>
          ))}
        </div>
      </section>

      <section id="environments" className="bg-surface">
        <div className={`${CONTAINER} py-14 lg:py-24`}>
          <Heading
            eyebrow="Coverage"
            title={`${environments.length} environments, ${allSkills} skills`}
            intro="Real workplaces and homes. Select an environment to see its skills."
          />
          <Coverage environments={environments} hours={hours} skills={skills} />
        </div>
      </section>

      <section id="mcap" className={`${CONTAINER} pt-14 lg:pt-24`}>
        <Heading
          eyebrow="What you receive"
          title="Inside an MCAP file"
          intro="One file per recording, with every stream on the same timeline. Open it in Foxglove or any MCAP reader."
        />
        <ol className="mt-8 grid gap-x-12 gap-y-8 sm:grid-cols-2 lg:mt-10 lg:grid-cols-3 lg:gap-y-12">
          {MCAP_CONTENTS.map(([title, detail], i) => (
            <McapItem key={title} title={title} detail={detail} index={i} />
          ))}
        </ol>
      </section>

      <section id="faq" className={`${CONTAINER} mt-16 grid gap-8 lg:mt-36 lg:grid-cols-[400px_minmax(0,1fr)] lg:gap-20`}>
        <div>
          <Heading eyebrow="FAQ" title="Good to know" />
        </div>
        <Faq />
      </section>

      <section className={`${CONTAINER} mt-16 lg:mt-32`}>
        <ExploreCard totalHours={Object.values(hours).reduce((a, b) => a + b, 0)} onStart={onStart} />
      </section>

      <footer className="mt-14 border-t border-line lg:mt-24">
        <div className={`${CONTAINER} flex flex-wrap items-center justify-between gap-x-8 gap-y-3 py-6 lg:py-8`}>
          <Logo />
          <p className="text-[14px] text-muted">© {new Date().getFullYear()} Awign Enterprises Private Limited. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
