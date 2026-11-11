import {
  DIFFICULTIES,
  DIFFICULTY_BY_ID,
  DOMAIN_BY_SLUG,
  SETUP_BY_ID,
  deliveryContents,
  SKILL_BY_SLUG,
  type DifficultyId,
  type SetupId,
} from "./catalog";
import { hoursBy, totals, type Inventory, type Totals } from "./inventory";

/**
 * Skills kept in each environment, by environment slug. No entry means all of its
 * skills, which is how every environment starts; the visitor takes away what they
 * don't need. An empty list means none, and that environment drops out of the request.
 */
export type SkillPicks = Record<string, string[]>;

export type Selection = {
  setup: SetupId | null;
  environments: string[];
  skills: SkillPicks;
  difficulties: DifficultyId[];
};

/** Step 2 opens with this environment already picked, on any setup that has it. */
export const DEFAULT_ENVIRONMENT = "industrial-manufacturing";

export const EMPTY_SELECTION: Selection = {
  setup: null,
  environments: [DEFAULT_ENVIRONMENT],
  skills: {},
  difficulties: [],
};

/** The chosen environments that still have a skill left in them. */
export function activeEnvironments(sel: Selection): string[] {
  return sel.environments.filter((e) => sel.skills[e]?.length !== 0);
}

/** Everything that matches: each environment counted on its own, with its own skills. */
function selectionTotals(sel: Selection, inv: Inventory): Totals {
  const sum: Totals = { hours: 0, episodes: 0, bytes: 0, mcapBytes: 0 };
  for (const domain of activeEnvironments(sel)) {
    const t = totals(inv, { setup: sel.setup, domains: [domain], skills: sel.skills[domain], difficulties: sel.difficulties });
    sum.hours += t.hours;
    sum.episodes += t.episodes;
    sum.bytes += t.bytes;
    sum.mcapBytes += t.mcapBytes;
  }
  return sum;
}

/** Hours that match every pick: setup, environments, and any skill / difficulty filters. Exact (from the episode index). */
export function matchingHours(sel: Selection, inv: Inventory): number {
  return selectionTotals(sel, inv).hours;
}

/**
 * Approximate size of everything that matches: its videos, plus its MCAPs while
 * they're offered. Uses the sizes in the episode index where it has them
 * (Ego-centric), otherwise the setup's measured GB per hour (head + wrist).
 */
export function matchingBytes(sel: Selection, inv: Inventory): number {
  const t = selectionTotals(sel, inv);
  if (!sel.setup) return t.bytes;
  const setup = SETUP_BY_ID[sel.setup];
  const video = t.bytes > 0 ? t.bytes : t.hours * setup.gbPerHour * 1e9;
  const { mcapGbPerHour } = deliveryContents(setup, inv.mcap);
  if (!mcapGbPerHour) return video;
  return video + (t.mcapBytes > 0 ? t.mcapBytes : t.hours * mcapGbPerHour * 1e9);
}

export type BreakdownSkill = { skill: string; hours: number; episodes: number; bytes: number };
export type BreakdownEnvironment = Omit<BreakdownSkill, "skill"> & { domain: string; skills: BreakdownSkill[] };

/** One selection's numbers, for a breakdown row. */
function rowFor(sel: Selection, inv: Inventory) {
  const t = selectionTotals(sel, inv);
  return { hours: Math.round(t.hours * 100) / 100, episodes: Math.round(t.episodes), bytes: Math.round(matchingBytes(sel, inv)) };
}

/**
 * What a request covers, each environment on its own, and within it each skill
 * with that environment's hours. Largest first, the order an admin works through.
 */
export function requestBreakdown(sel: Selection, inv: Inventory): BreakdownEnvironment[] {
  return activeEnvironments(sel)
    .map((domain) => {
      const one = { ...sel, environments: [domain] };
      const found = hoursBy(inv, "skill", { setup: sel.setup, domains: [domain], skills: sel.skills[domain], difficulties: sel.difficulties });
      const skills = Object.keys(found)
        .map((skill) => ({ skill, ...rowFor({ ...one, skills: { [domain]: [skill] } }, inv) }))
        .sort((a, b) => b.hours - a.hours);
      return { domain, ...rowFor(one, inv), skills };
    })
    .sort((a, b) => b.hours - a.hours);
}

/** Every skill named in a chosen environment, without repeats. Environments left with all their skills name none. */
export function pickedSkills(sel: Selection): string[] {
  return [...new Set(sel.environments.flatMap((e) => sel.skills[e] ?? []))];
}

/** The visitor has taken a skill away somewhere. */
export function skillsNarrowed(sel: Selection): boolean {
  return sel.environments.some((e) => sel.skills[e] !== undefined);
}

/** Skills for a one-line summary: names while they fit, then a count. */
export function skillsSummary(sel: Selection, inv: Inventory): string {
  const active = activeEnvironments(sel);
  if (!active.length) return "No skills";
  if (active.every((e) => sel.skills[e] === undefined)) return "All skills";
  // An environment left alone counts with all its skills, not as none.
  const slugs = new Set<string>();
  for (const domain of active) {
    const kept = sel.skills[domain] ?? Object.keys(hoursBy(inv, "skill", { setup: sel.setup, domains: [domain] }));
    kept.forEach((s) => slugs.add(s));
  }
  const names = [...slugs].map((s) => SKILL_BY_SLUG[s]?.short ?? s);
  return names.length <= 3 ? names.join(", ") : `${names.slice(0, 2).join(", ")} +${names.length - 2} more`;
}

export function difficultySummary(sel: Selection): string {
  if (!sel.difficulties.length) return "All levels";
  return DIFFICULTIES.filter((d) => sel.difficulties.includes(d.id))
    .map((d) => d.name)
    .join(", ");
}

/** "75 GB", "1.9 TB": decimal units, as disks and clouds count them. */
export function formatSize(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toLocaleString("en-IN", { maximumFractionDigits: bytes >= 1e14 ? 0 : 1 })} TB`;
  if (bytes >= 1e9) return `${(bytes / 1e9).toLocaleString("en-IN", { maximumFractionDigits: bytes >= 1e11 ? 0 : 1 })} GB`;
  return `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

/** Names of the chosen environments, in the order they were picked. */
export function environmentNames(sel: Selection): string[] {
  return activeEnvironments(sel).map((e) => DOMAIN_BY_SLUG[e]?.name ?? e);
}

/** Environments for the selection card: every name up to three, then the first two and "+N more" (e.g. after "Select all"). */
export function environmentsList(sel: Selection): string {
  const names = environmentNames(sel);
  if (!names.length) return "—";
  return names.length <= 3 ? names.join(", ") : `${names.slice(0, 2).join(", ")} +${names.length - 2} more`;
}

/** Environments for a one-line summary: the names while they fit (up to two), a count after that. */
export function environmentsShort(sel: Selection): string {
  const n = activeEnvironments(sel).length;
  return n <= 2 ? environmentNames(sel).join(", ") : `${n} environment types`;
}

export function formatHours(h: number): string {
  return Math.round(h).toLocaleString("en-IN");
}

/** Like formatHours, but keeps one decimal under 10 h, so a 5.5 h match doesn't read as "6" (or "0"). */
export function formatHoursFine(h: number): string {
  if (h <= 0) return "0";
  if (h < 0.1) return "<0.1";
  if (h < 10) return String(Math.round(h * 10) / 10);
  return formatHours(h);
}

export type Contact = {
  fullName: string;
  email: string;
  phone: string;
  company: string;
  /** "Do you want this data for your model/robot training?" Required; null until answered. */
  forTraining: boolean | null;
};

/** The typed-in contact fields (everything but the Yes / No question). */
export type ContactText = Exclude<keyof Contact, "forTraining">;

export const EMPTY_CONTACT: Contact = { fullName: "", email: "", phone: "", company: "", forTraining: null };

export type RequestKind = "dataset" | "sample";

export type RequestPayload = Selection & Contact & { kind: RequestKind };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateContact(c: Contact): Partial<Record<keyof Contact, string>> {
  const errors: Partial<Record<keyof Contact, string>> = {};
  const name = c.fullName.trim();
  if (!name) errors.fullName = "Enter your full name.";
  else if (name.length > 120) errors.fullName = "Keep your name under 120 characters.";

  const email = c.email.trim();
  if (!email) errors.email = "Enter your email so we can send the dataset.";
  else if (!EMAIL_RE.test(email) || email.length > 254) errors.email = "Enter an email like name@company.com.";

  const company = c.company.trim();
  if (!company) errors.company = "Enter your company name.";
  else if (company.length > 160) errors.company = "Keep the company name under 160 characters.";

  const phone = c.phone.trim();
  if (phone && !/^\+?[\d\s\-()]{7,20}$/.test(phone)) errors.phone = "Use digits only, with an optional + country code.";

  if (typeof c.forTraining !== "boolean") errors.forTraining = "Choose Yes or No.";
  return errors;
}

/** Server-side check of a full payload. Returns an error message, or null if valid. */
export function validatePayload(p: RequestPayload): string | null {
  if (p.kind !== "dataset" && p.kind !== "sample") return "Unknown request type.";
  if (!p.setup || !SETUP_BY_ID[p.setup]) return "Choose a capture setup.";
  if (!Array.isArray(p.environments) || p.environments.length === 0) return "Pick at least one environment type.";
  if (p.environments.some((e) => !DOMAIN_BY_SLUG[e])) return "One of the environment types is not in the catalog.";
  if (!p.skills || typeof p.skills !== "object" || Array.isArray(p.skills)) return "One of the skills is not in the catalog.";
  if (Object.values(p.skills).some((list) => !Array.isArray(list) || list.some((s) => !SKILL_BY_SLUG[s]))) return "One of the skills is not in the catalog.";
  if (!Array.isArray(p.difficulties) || p.difficulties.some((d) => !DIFFICULTY_BY_ID[d])) return "Unknown difficulty.";
  const contactErrors = validateContact(p);
  const first = Object.values(contactErrors)[0];
  if (first) return first;
  return null;
}
