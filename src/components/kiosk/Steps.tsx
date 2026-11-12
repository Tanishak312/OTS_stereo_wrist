"use client";

import { useCallback, useMemo, useState } from "react";
import {
  DATASET,
  DIFFICULTIES,
  DOMAINS,
  deliveryContents,
  domainName,
  SETUP_BY_ID,
  SETUPS,
  SKILLS,
  skillName,
  type DifficultyId,
  type SetupId,
} from "@/lib/catalog";
import { episodesByDomain, hoursBy, totals } from "@/lib/inventory";
import { delay, stagger } from "@/lib/motion";
import { DEFAULT_ENVIRONMENT, activeEnvironments, difficultySummary, formatHours, formatHoursFine, requestBreakdown, type Selection } from "@/lib/selection";
import { useInventory } from "./InventoryContext";
import { Photo } from "../Photo";
import { MoreDomainsDialog } from "./MoreDomainsDialog";
import { StepPreview, useMinWidth, usePreviewSlugs } from "./Preview";
import { SelectionPanel } from "./SelectionPanel";
import { PreviewDialog, VideoCard, type Origin } from "./VideoCards";
import { ArrowRight, CheckIcon, Chip, Eyebrow, SelectAllButton, StepLayout, Title } from "./ui";

/**
 * The preview card for steps 2-4 (Ego-centric clips only). Desktop puts it above the
 * selection; a phone puts it after the step's own content so picking stays on top.
 * Only one copy is ever mounted, so only one video loads.
 */
function useStepPreview(setup: Selection["setup"], picked: string[]) {
  const wide = useMinWidth(1024);
  const slugs = usePreviewSlugs();
  const show = setup === "ego" && picked.some((e) => slugs.includes(e));
  return { wide, preview: show ? <StepPreview picked={picked} /> : null };
}

function toggle<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

export function SetupStep({ sel, onChange }: { sel: Selection; onChange: (s: Selection) => void }) {
  const inv = useInventory();
  // Picking a setup starts step 2 on the default environment, or on the setup's
  // biggest if it wasn't recorded there, and drops skill / difficulty picks made for
  // the other one: head + wrist is all "Home", so Ego-centric picks would match nothing.
  const pick = (id: SetupId) => {
    if (id === sel.setup) return;
    const hours = hoursBy(inv, "domain", { setup: id });
    const first = hours[DEFAULT_ENVIRONMENT] > 0 ? DEFAULT_ENVIRONMENT : Object.entries(hours).sort((a, b) => b[1] - a[1])[0]?.[0];
    onChange({ ...sel, setup: id, environments: first ? [first] : [], skills: {}, difficulties: [] });
  };
  return (
    <StepLayout
      left={
        <>
          <Eyebrow mobile="Off-the-shelf data · Pre-recorded" desktop="Step 01 — Capture setup" />
          <Title>Choose a capture setup</Title>
          <SelectionPanel sel={sel} step={1} />
        </>
      }
      right={
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:gap-7" role="radiogroup" aria-label="Capture setup">
          {SETUPS.map((s, i) => {
            const selected = sel.setup === s.id;
            const t = totals(inv, { setup: s.id });
            // A setup with no recordings in the index yet can't be picked.
            const available = t.episodes > 0;
            return (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={!available}
                onClick={() => pick(s.id)}
                style={stagger(i, 120)}
                className={`group relative flex animate-fade-up flex-col overflow-hidden rounded-[14px] border-[1.5px] bg-white p-[7px] text-left transition-[border-color,box-shadow,transform,translate,scale] duration-200 enabled:active:scale-[0.985] disabled:cursor-not-allowed lg:rounded-[20px] lg:border-2 lg:p-[11px] ${
                  selected ? "border-brand ring-1 ring-brand" : available ? "border-line hover:border-subtle" : "border-line opacity-60"
                }`}
              >
                <Photo
                  src={s.image}
                  alt={`${s.name} capture rig`}
                  label={s.name}
                  className="aspect-[336/150] w-full rounded-[10px] lg:aspect-[352/244] lg:rounded-xl"
                  // Bias the crop upward so the head-mounted camera stays in frame on the short mobile/tablet cards.
                  imgClassName="object-[50%_20%] group-hover:scale-[1.03]"
                />
                <div className="px-1.5 pt-2.5 pb-1.5 lg:px-2 lg:pt-4 lg:pb-2">
                  <p className="text-[18px] font-semibold lg:text-[28px] lg:leading-tight lg:font-medium">{s.name}</p>
                  <p className="mt-0.5 text-[13px] text-muted lg:mt-1 lg:text-[17px]">
                    {available ? (
                      <>
                        <span className="tabular text-[15px] font-semibold text-brand lg:text-[24px]">{formatHours(t.hours)} h</span>
                        <span className="lg:ml-1.5"> available · {formatHours(t.episodes)} episodes</span>
                      </>
                    ) : (
                      <span className="font-semibold text-ink/70 lg:text-[20px]">Coming soon · {s.detail}</span>
                    )}
                  </p>
                </div>
                {selected && (
                  <span className="absolute top-4 right-4 flex h-7 w-7 animate-pop items-center justify-center rounded-full bg-brand text-white lg:top-6 lg:right-6 lg:h-9 lg:w-9">
                    <CheckIcon className="h-4 w-4 lg:h-5 lg:w-5" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      }
    />
  );
}

/** Domains shown as photo cards (they have photos); the rest open in the "More environments" panel. */
const COLLAPSED_COUNT = 8;
const SHOWN_DOMAINS = DOMAINS.slice(0, COLLAPSED_COUNT);

export function EnvironmentsStep({
  sel,
  onChange,
  videoCards = false,
}: {
  sel: Selection;
  onChange: (s: Selection) => void;
  /** /v2: cards are video thumbnails that play on hover and open a full preview on click. */
  videoCards?: boolean;
}) {
  const inv = useInventory();
  const hours = useMemo(() => hoursBy(inv, "domain", { setup: sel.setup }), [inv, sel.setup]);
  const episodes = useMemo(() => episodesByDomain(inv, sel.setup), [inv, sel.setup]);
  // "Select all" picks every environment that has recordings for this setup, including the ones behind "View all".
  const available = DOMAINS.filter((d) => (hours[d.slug] ?? 0) > 0).map((d) => d.slug);
  // A setup recorded in only a few environments (head + wrist: just Home) shows those as the cards and
  // nothing else, rather than eight greyed-out photo cards with its data behind "View all".
  const few = available.length <= COLLAPSED_COUNT;
  const shownDomains = few ? DOMAINS.filter((d) => available.includes(d.slug)) : SHOWN_DOMAINS;
  // The panel lists the rest by size, with the catch-all "Other" last (as in the design).
  const moreDomains = useMemo(() => {
    if (few) return [];
    const rest = DOMAINS.slice(COLLAPSED_COUNT);
    const byHours = rest.filter((d) => d.slug !== "other").sort((a, b) => (hours[b.slug] ?? 0) - (hours[a.slug] ?? 0));
    return [...byHours, ...rest.filter((d) => d.slug === "other")];
  }, [hours, few]);
  const [moreOpen, setMoreOpen] = useState(false);
  const hiddenHours = moreDomains.reduce((acc, d) => acc + (hours[d.slug] ?? 0), 0);
  const pickedInMore = moreDomains.filter((d) => sel.environments.includes(d.slug)).length;
  const closeMore = useCallback(() => setMoreOpen(false), []);
  const allPicked = available.length > 0 && available.every((s) => sel.environments.includes(s));
  const { wide, preview } = useStepPreview(sel.setup, sel.environments);
  const clipSlugs = usePreviewSlugs();
  const [opened, setOpened] = useState<{ slug: string; origin: Origin; startAt: number } | null>(null);
  const openedDomain = opened ? DOMAINS.find((d) => d.slug === opened.slug) : undefined;
  const closePreview = useCallback(() => setOpened(null), []);

  return (
    <StepLayout
      left={
        <>
          <Eyebrow mobile="Step 2 · Environment types" desktop="Step 02 — Environment types" />
          <Title>Pick the environment types you need</Title>
          {wide && preview}
          <SelectionPanel sel={sel} step={2} />
        </>
      }
      right={
        <>
          <div className="mb-2 flex animate-fade-up items-center justify-between gap-4 lg:mb-4">
            <p className="tabular text-[14px] text-muted lg:text-[17px]">
              {sel.environments.length} of {available.length} environment types selected
            </p>
            <SelectAllButton
              all={allPicked}
              disabled={!available.length}
              onClick={() => onChange({ ...sel, environments: allPicked ? [] : available })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:gap-[22px]">
            {shownDomains.map((d, i) => {
              const selected = sel.environments.includes(d.slug);
              const empty = !((hours[d.slug] ?? 0) > 0);
              if (videoCards)
                return (
                  <VideoCard
                    key={d.slug}
                    domain={d}
                    index={i}
                    hours={hours[d.slug] ?? 0}
                    episodes={episodes[d.slug] ?? 0}
                    // Clips are Ego-centric recordings, so only that setup's cards play.
                    hasClip={sel.setup === "ego" && clipSlugs.includes(d.slug)}
                    selected={selected}
                    disabled={empty}
                    paused={opened !== null}
                    onToggle={() => onChange({ ...sel, environments: toggle(sel.environments, d.slug) })}
                    onOpen={(origin, startAt) => setOpened({ slug: d.slug, origin, startAt })}
                  />
                );
              return (
                <button
                  key={d.slug}
                  type="button"
                  aria-pressed={selected}
                  disabled={empty && !selected}
                  onClick={() => onChange({ ...sel, environments: toggle(sel.environments, d.slug) })}
                  style={stagger(i, 100)}
                  className={`group relative flex animate-fade-up flex-col overflow-hidden rounded-[14px] border-[1.5px] bg-white p-[7px] text-left transition-[border-color,box-shadow,transform,translate,scale] duration-200 enabled:active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 lg:rounded-[18px] lg:p-[11px] ${
                    selected ? "border-brand ring-1 ring-brand" : "border-line enabled:hover:border-subtle"
                  }`}
                >
                  <Photo
                    src={d.image}
                    alt=""
                    className="aspect-[155/60] w-full rounded-lg lg:aspect-[222/97] lg:rounded-xl"
                    imgClassName="group-hover:scale-[1.04]"
                  />
                  <div className="px-1.5 pt-2.5 pb-2 lg:px-2 lg:pt-4 lg:pb-2">
                    <p className="text-[15px] leading-tight font-semibold lg:text-[24px] lg:font-medium">{d.name}</p>
                    <p className="mt-1 text-[12px] text-muted lg:mt-1.5 lg:text-[17px]">
                      <span className="tabular text-[14px] font-semibold text-brand lg:text-[22px]">{formatHoursFine(hours[d.slug] ?? 0)} h</span>{" "}
                      <span className="tabular lg:ml-1">{formatHours(episodes[d.slug] ?? 0)}</span> episodes
                    </p>
                  </div>
                  {selected && (
                    <span className="absolute top-3 right-3 flex h-6 w-6 animate-pop items-center justify-center rounded-full bg-brand text-white lg:top-5 lg:right-5 lg:h-8 lg:w-8">
                      <CheckIcon className="h-3.5 w-3.5 lg:h-4 lg:w-4" />
                    </span>
                  )}
                </button>
              );
            })}
            {moreDomains.length > 0 && (
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-haspopup="dialog"
              style={stagger(COLLAPSED_COUNT, 100)}
              className={`group/btn flex animate-fade-up flex-col justify-center rounded-2xl border-2 border-dashed p-4 text-left transition-[border-color,background-color,transform,translate,scale] duration-200 hover:bg-brand-50/50 active:scale-[0.98] lg:rounded-[18px] lg:px-7 ${
                pickedInMore ? "border-brand/60 bg-brand-50/40" : "border-[#d6d9df] hover:border-subtle"
              }`}
            >
              <span className="text-base font-medium lg:text-[25px] lg:leading-tight">+{moreDomains.length} more types</span>
              <span className="tabular mt-1 text-xs text-muted lg:text-[16px]">
                {formatHours(hiddenHours)} h
                {/* Keeps picks made in the panel visible from the grid. */}
                {pickedInMore > 0 && <span className="font-semibold text-brand"> · {pickedInMore} selected</span>}
              </span>
              <span className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-brand lg:text-[22px] lg:font-normal">
                View all <ArrowRight className="h-4 w-4 lg:h-5 lg:w-5" />
              </span>
            </button>
            )}
            {moreOpen && (
              <MoreDomainsDialog
                domains={moreDomains}
                hours={hours}
                selected={sel.environments}
                onToggle={(slug) => onChange({ ...sel, environments: toggle(sel.environments, slug) })}
                onClose={closeMore}
              />
            )}
          </div>
          {!wide && preview}
          {opened && openedDomain && sel.setup && (
            <PreviewDialog
              domain={openedDomain}
              setup={sel.setup}
              hours={hours[opened.slug] ?? 0}
              episodes={episodes[opened.slug] ?? 0}
              selected={sel.environments.includes(opened.slug)}
              disabled={!((hours[opened.slug] ?? 0) > 0)}
              origin={opened.origin}
              startAt={opened.startAt}
              onToggle={() => onChange({ ...sel, environments: toggle(sel.environments, opened.slug) })}
              onClose={closePreview}
            />
          )}
        </>
      }
    />
  );
}

/** The chips of one environment: only the skills recorded there, each with that environment's hours. All start selected. */
function EnvironmentSkills({
  domain,
  sel,
  open,
  onOpen,
  onChange,
}: {
  domain: string;
  sel: Selection;
  open: boolean;
  onOpen: () => void;
  /** undefined = all of its skills. */
  onChange: (kept: string[] | undefined) => void;
}) {
  const inv = useInventory();
  const recorded = hoursBy(inv, "skill", { setup: sel.setup, domains: [domain] });
  const hours = hoursBy(inv, "skill", { setup: sel.setup, domains: [domain], difficulties: sel.difficulties });
  const skills = SKILLS.filter((s) => (recorded[s.slug] ?? 0) > 0).sort((a, b) => (hours[b.slug] ?? 0) - (hours[a.slug] ?? 0));
  const all = skills.map((s) => s.slug);
  const kept = sel.skills[domain] ?? all;
  const allKept = sel.skills[domain] === undefined;
  const envHours = kept.length ? totals(inv, { setup: sel.setup, domains: [domain], skills: kept, difficulties: sel.difficulties }).hours : 0;

  return (
    <section className="rounded-2xl border-[1.5px] border-line lg:rounded-[20px]">
      <div className="flex items-center gap-3 px-4 lg:gap-4 lg:px-6">
        <button type="button" onClick={onOpen} aria-expanded={open} className="flex min-h-16 min-w-0 flex-1 items-center gap-3 py-2 text-left">
          <span aria-hidden="true" className={`shrink-0 text-[18px] text-muted transition-transform duration-200 lg:text-[20px] ${open ? "rotate-90" : ""}`}>
            ▸
          </span>
          <span className="min-w-0">
            <span className="block text-[17px] leading-snug font-medium lg:text-[21px]">{domainName(domain)}</span>
            <span className="block text-[13px] text-muted lg:text-[15px]">
              {allKept ? `All ${skills.length} skills` : kept.length ? `${kept.length} of ${skills.length} skills` : "No skills, left out"}
            </span>
          </span>
        </button>
        {!allKept && kept.length > 0 && (
          <button type="button" onClick={() => onChange([])} className="min-h-11 shrink-0 px-1 text-[15px] font-medium text-muted hover:underline lg:text-[17px]">
            Clear all
          </button>
        )}
        <SelectAllButton all={allKept} disabled={!skills.length} onClick={() => onChange(allKept ? [] : undefined)} />
        <span className="tabular shrink-0 text-[16px] font-semibold text-brand lg:text-[21px]">{formatHoursFine(envHours)} h</span>
      </div>
      {open && (
        <div className="flex flex-wrap gap-2 px-4 pb-4 lg:gap-2.5 lg:px-6 lg:pb-5">
          {skills.map((s) => (
            <Chip
              key={s.slug}
              compact
              label={s.short}
              meta={`${formatHoursFine(hours[s.slug] ?? 0)} h`}
              selected={kept.includes(s.slug)}
              onToggle={() => {
                const next = toggle(kept, s.slug);
                onChange(next.length === all.length ? undefined : next);
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/** Up to this many environments start open; past it, only the first does, so the page stays short. */
const OPEN_ENVIRONMENTS = 4;

export function TasksStep({ sel, onChange }: { sel: Selection; onChange: (s: Selection) => void }) {
  const inv = useInventory();
  // Largest first, by what the environment holds, so rows don't jump while chips are toggled.
  const environments = useMemo(() => {
    const all = hoursBy(inv, "domain", { setup: sel.setup });
    return [...sel.environments].sort((a, b) => (all[b] ?? 0) - (all[a] ?? 0));
  }, [inv, sel.setup, sel.environments]);
  const [open, setOpen] = useState<Set<string>>(
    () => new Set(environments.filter((e, i) => environments.length <= OPEN_ENVIRONMENTS || i === 0 || sel.skills[e] !== undefined)),
  );

  // What each level would add, under the skills picked so far.
  const diffHours: Record<string, number> = {};
  for (const domain of activeEnvironments(sel)) {
    const part = hoursBy(inv, "difficulty", { setup: sel.setup, domains: [domain], skills: sel.skills[domain] });
    for (const [d, h] of Object.entries(part)) diffHours[d] = (diffHours[d] ?? 0) + h;
  }
  const diffOptions = DIFFICULTIES.filter((d) => (diffHours[d.id] ?? 0) > 0).map((d) => d.id);
  const allDiffs = diffOptions.length > 0 && diffOptions.every((d) => sel.difficulties.includes(d));
  const graded = !sel.setup || SETUP_BY_ID[sel.setup].graded;
  const { wide: wideScreen, preview } = useStepPreview(sel.setup, activeEnvironments(sel));

  return (
    <StepLayout
      left={
        <>
          <Eyebrow mobile="Step 3 · Tasks (optional)" desktop="Step 03 — Tasks (optional)" />
          <Title>Narrow by task</Title>
          {wideScreen && preview}
          <SelectionPanel sel={sel} step={3} />
        </>
      }
      right={
        <>
          <section className="animate-fade-up" style={delay(100)}>
            <h2 className="text-[18px] font-semibold lg:text-[26px]">Skills in each environment</h2>
            <p className="mt-1 text-[14px] text-muted lg:text-[17px]">All skills are selected. Tap any you don&rsquo;t need to remove it.</p>
            <div className="mt-3 space-y-3 lg:mt-5 lg:space-y-4">
              {environments.map((domain) => (
                <EnvironmentSkills
                  key={domain}
                  domain={domain}
                  sel={sel}
                  open={open.has(domain)}
                  onOpen={() =>
                    setOpen((now) => {
                      const next = new Set(now);
                      if (!next.delete(domain)) next.add(domain);
                      return next;
                    })
                  }
                  onChange={(kept) => {
                    const skills = { ...sel.skills };
                    if (kept) skills[domain] = kept;
                    else delete skills[domain];
                    onChange({ ...sel, skills });
                  }}
                />
              ))}
            </div>
          </section>

          {graded && (
            <section className="mt-8 animate-fade-up lg:mt-10" style={delay(200)}>
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-[18px] font-semibold lg:text-[26px]">Difficulty</h2>
                <SelectAllButton
                  all={allDiffs}
                  disabled={!diffOptions.length}
                  onClick={() => onChange({ ...sel, difficulties: allDiffs ? [] : diffOptions })}
                />
              </div>
              <div className="mt-3 flex flex-wrap gap-2 lg:mt-4 lg:gap-2.5">
                {DIFFICULTIES.map((d) => (
                  <Chip
                    key={d.id}
                    compact
                    label={d.name}
                    meta={`${formatHoursFine(diffHours[d.id] ?? 0)} h`}
                    selected={sel.difficulties.includes(d.id)}
                    disabled={!(diffHours[d.id] > 0) && !sel.difficulties.includes(d.id)}
                    onToggle={() => onChange({ ...sel, difficulties: toggle<DifficultyId>(sel.difficulties, d.id) })}
                  />
                ))}
              </div>
            </section>
          )}
          {!wideScreen && preview}
        </>
      }
    />
  );
}

export function ReviewStep({ sel }: { sel: Selection }) {
  const inv = useInventory();
  const contents = sel.setup ? deliveryContents(SETUP_BY_ID[sel.setup], inv.mcap) : null;
  const graded = !sel.setup || SETUP_BY_ID[sel.setup].graded;
  const rows: [string, string][] = [
    ["Capture setup", sel.setup ? SETUP_BY_ID[sel.setup].name : "—"],
    // Only for setups whose recordings are graded; head + wrist has no difficulty at all.
    ...(graded ? [["Difficulty", difficultySummary(sel)] as [string, string]] : []),
    ["Delivery", contents?.delivery ?? DATASET.delivery],
  ];
  const environments = requestBreakdown(sel, inv);
  // Long lists take two columns, so "Select all" still reads as a list and not a wall.
  const wide = environments.length > 6;
  const { wide: wideScreen, preview } = useStepPreview(sel.setup, activeEnvironments(sel));

  return (
    <StepLayout
      left={
        <>
          <Eyebrow mobile="Step 4 · Review" desktop="Step 04 — Review" />
          <Title>Your dataset, ready to ship</Title>
          {wideScreen && preview}
          <SelectionPanel sel={sel} step={4} />
        </>
      }
      right={
        <>
          <dl style={delay(80)} className="animate-fade-up divide-y divide-line rounded-2xl border-[1.5px] border-line px-[19px] lg:rounded-[28px] lg:border-2 lg:px-[30px] lg:py-1">
            {rows.map(([label, value]) => (
              <div key={label} className="flex min-h-[49px] items-center justify-between gap-4 py-2 lg:min-h-[74px]">
                <dt className="text-[15px] text-muted lg:text-[21px]">{label}</dt>
                <dd className="text-right text-[16px] font-semibold lg:text-[23px] lg:font-medium">
                  {value.split(" (")[0]}
                  {/* What's in brackets is detail: its own quieter line, so the row reads as one word. */}
                  {value.includes(" (") && (
                    <span className="mt-0.5 block text-[13px] font-normal text-muted lg:text-[16px]">({value.split(" (").slice(1).join(" (")}</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>

          <section style={delay(160)} className="mt-4 animate-fade-up rounded-2xl border-[1.5px] border-line px-[19px] py-4 lg:mt-6 lg:rounded-[28px] lg:border-2 lg:px-[30px] lg:py-6">
            <h2 className="text-[15px] text-muted lg:text-[21px]">
              {environments.length} environment type{environments.length === 1 ? "" : "s"} and their skills
            </h2>
            <ul className={`mt-1 lg:mt-2 ${wide ? "lg:grid lg:grid-cols-2 lg:gap-x-10" : ""}`}>
              {environments.map((e) => {
                const picked = sel.skills[e.domain] !== undefined;
                return (
                  <li key={e.domain} className="border-b border-line py-3 last:border-b-0">
                    <p className="flex items-baseline justify-between gap-4">
                      <span className="text-[16px] leading-snug font-semibold lg:text-[18px] lg:font-medium">{domainName(e.domain)}</span>
                      <span className="tabular shrink-0 text-[15px] font-semibold text-brand lg:text-[17px]">{formatHoursFine(e.hours)} h</span>
                    </p>
                    {picked ? (
                      <ul className="mt-1 space-y-0.5">
                        {e.skills.map((s) => (
                          <li key={s.skill} className="flex justify-between gap-4 text-[14px] text-muted lg:text-[15px]">
                            <span>{skillName(s.skill)}</span>
                            <span className="tabular shrink-0">{formatHoursFine(s.hours)} h</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-0.5 text-[14px] text-muted lg:text-[15px]">
                        All {e.skills.length} skill{e.skills.length === 1 ? "" : "s"}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
          {!wideScreen && preview}
        </>
      }
    />
  );
}
