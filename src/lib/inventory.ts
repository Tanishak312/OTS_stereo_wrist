import { DIFFICULTIES, DOMAINS, SKILLS, type DifficultyId, type SetupId } from "./catalog";

// What the dataset actually contains, per capture setup x environment x skill x
// difficulty, from the episode index (ots_inventory() in Supabase). Every hour
// figure the kiosk shows, and the hours the server records on a request, are
// sums over these cells, so they are exact for any combination of picks.
// Pure functions only: used on the server and in the browser.

/** [setup, domain, skill, difficulty, episodes, seconds, video bytes, MCAP bytes] */
export type Cell = [string, string, string, string, number, number, number, number];

export type Inventory = {
  cells: Cell[];
  /** Distinct task names in the index; null for the fallback estimate. */
  tasks: number | null;
  /** "live" = episode index; "estimate" = datasheet fallback when Supabase is unreachable. */
  source: "live" | "estimate";
  /** Deliveries ship MCAP too (OFFER_MCAP, set on the server). */
  mcap: boolean;
};

export type Filter = {
  setup?: SetupId | null;
  /** undefined = every environment; [] = none. */
  domains?: string[];
  /** undefined or [] = every skill / difficulty (that's what "no filter" means in the kiosk). */
  skills?: string[];
  difficulties?: DifficultyId[];
};

export type Totals = { hours: number; episodes: number; bytes: number; mcapBytes: number };

function matcher(f: Filter): (c: Cell) => boolean {
  const domains = f.domains && new Set(f.domains);
  const skills = f.skills?.length ? new Set(f.skills) : null;
  const diffs = f.difficulties?.length ? new Set<string>(f.difficulties) : null;
  return (c) =>
    (!f.setup || c[0] === f.setup) && (!domains || domains.has(c[1])) && (!skills || skills.has(c[2])) && (!diffs || diffs.has(c[3]));
}

export function totals(inv: Inventory, f: Filter = {}): Totals {
  const match = matcher(f);
  const t = { hours: 0, episodes: 0, bytes: 0, mcapBytes: 0 };
  for (const c of inv.cells) {
    if (!match(c)) continue;
    t.hours += c[5] / 3600;
    t.episodes += c[4];
    t.bytes += c[6];
    t.mcapBytes += c[7];
  }
  return t;
}

/** Hours per value of one dimension (e.g. per domain), under a filter on the others. */
export function hoursBy(inv: Inventory, dim: "setup" | "domain" | "skill" | "difficulty", f: Filter = {}): Record<string, number> {
  const idx = { setup: 0, domain: 1, skill: 2, difficulty: 3 }[dim];
  const match = matcher(f);
  const out: Record<string, number> = {};
  for (const c of inv.cells) if (match(c)) out[c[idx]] = (out[c[idx]] ?? 0) + c[5] / 3600;
  return out;
}

/** Episodes per domain for a setup (environment cards). */
export function episodesByDomain(inv: Inventory, setup?: SetupId | null): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of inv.cells) if (!setup || c[0] === setup) out[c[1]] = (out[c[1]] ?? 0) + c[4];
  return out;
}

/** How many different skills each domain has recordings of. */
export function skillsPerDomain(inv: Inventory): Record<string, number> {
  const seen: Record<string, Set<string>> = {};
  for (const c of inv.cells) if (c[5] > 0) (seen[c[1]] ??= new Set()).add(c[2]);
  return Object.fromEntries(Object.entries(seen).map(([d, s]) => [d, s.size]));
}

export function parseInventory(data: unknown): Inventory {
  const d = data as { cells?: unknown; tasks?: unknown } | null;
  if (!d || !Array.isArray(d.cells)) throw new Error("ots_inventory returned no cells");
  const cells = d.cells.map((c) => {
    const a = c as unknown[];
    // No eighth value: the database is from before 011.
    return [String(a[0]), String(a[1]), String(a[2]), String(a[3]), Number(a[4]), Number(a[5]), Number(a[6]), Number(a[7] ?? 0)] as Cell;
  });
  return { cells, tasks: typeof d.tasks === "number" ? d.tasks : null, source: "live", mcap: false };
}

/**
 * Fallback when the index can't be read: spreads the datasheet's per-domain
 * hours across skills and difficulties by their shares (the old kiosk estimate),
 * so the kiosk keeps working. Numbers are approximate; the UI says so.
 * Ego-centric only: the datasheet's figures are ego-centric, and inventing
 * head + wrist hours here would inflate every total (4,147 h became 4,498 h).
 */
export function estimateInventory(): Inventory {
  const skillTotal = SKILLS.reduce((a, s) => a + s.hours, 0);
  const cells: Cell[] = [];
  for (const d of DOMAINS) {
    if (!d.hours) continue;
    for (const s of SKILLS) {
      for (const diff of DIFFICULTIES) {
        const part = (s.hours / skillTotal) * (diff.share / 100);
        cells.push(["ego", d.slug, s.slug, diff.id, d.episodes * part, d.hours * part * 3600, 0, 0]);
      }
    }
  }
  return { cells, tasks: null, source: "estimate", mcap: false };
}
