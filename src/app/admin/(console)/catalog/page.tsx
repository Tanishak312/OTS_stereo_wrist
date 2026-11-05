import { DATA_PACKAGE, DATASET, DOMAINS, HARDWARE_SPECS, SETUPS, SKILLS } from "@/lib/catalog";
import { totals } from "@/lib/inventory";
import { loadInventory } from "@/lib/inventory-server";
import { formatHours, formatHoursFine } from "@/lib/selection";

export const metadata = { title: "Catalog · OTS admin" };

// Read-only reference of what the kiosk offers, with the same live numbers the
// kiosk shows (episode index), so reviewers can sanity-check a request.
export default async function CatalogPage() {
  const inv = await loadInventory();
  const all = totals(inv);
  const share = (h: number) => (all.hours ? `${((h / all.hours) * 100).toFixed(1)}%` : "—");
  const domainRows = DOMAINS.map((d) => ({ d, t: totals(inv, { domains: [d.slug] }) })).sort((a, b) => b.t.hours - a.t.hours);
  const skillRows = SKILLS.map((s) => ({ s, t: totals(inv, { skills: [s.slug] }) })).sort((a, b) => b.t.hours - a.t.hours);
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Catalog</h1>
      <p className="mt-1 text-sm text-muted">
        {inv.source === "live"
          ? "What the kiosk offers, live from the episode index (ots_episodes). Refreshes every 5 minutes."
          : "Couldn't read the episode index, so these are the v3 datasheet estimates. Run the latest supabase/*.sql and check the server log."}
      </p>

      <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Usable hours", `${formatHours(all.hours)} h`],
          ["Episodes", formatHours(all.episodes)],
          ["Task types", inv.tasks === null ? formatHours(DATASET.taskTypes) : formatHours(inv.tasks)],
          ["Operators", formatHours(DATASET.operators)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-line p-4">
            <dt className="text-sm text-muted">{k}</dt>
            <dd className="tabular mt-1 text-2xl font-semibold">{v}</dd>
          </div>
        ))}
      </dl>

      <h2 className="mt-8 text-lg font-semibold">Capture setups</h2>
      <Table
        head={["Setup", "Hours", "Episodes"]}
        align={["left", "right", "right"]}
        rows={SETUPS.map((s) => {
          const t = totals(inv, { setup: s.id });
          return [s.name, t.episodes ? `${formatHours(t.hours)} h` : "Coming soon", formatHours(t.episodes)];
        })}
      />

      <h2 className="mt-8 text-lg font-semibold">Environments ({DOMAINS.length})</h2>
      <Table
        head={["Domain", "Hours", "Share", "Episodes"]}
        align={["left", "right", "right", "right"]}
        rows={domainRows.map(({ d, t }) => [d.name, formatHoursFine(t.hours), share(t.hours), formatHours(t.episodes)])}
      />

      <h2 className="mt-8 text-lg font-semibold">Manipulation skills ({SKILLS.length})</h2>
      <Table
        head={["Skill group", "Hours", "Share", "Episodes"]}
        align={["left", "right", "right", "right"]}
        rows={skillRows.map(({ s, t }) => [s.name, formatHoursFine(t.hours), share(t.hours), formatHours(t.episodes)])}
      />

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <div>
          <h2 className="text-lg font-semibold">Capture hardware</h2>
          <Table head={["Parameter", "Specification"]} align={["left", "left"]} rows={HARDWARE_SPECS} />
        </div>
        <div>
          <h2 className="text-lg font-semibold">Data package</h2>
          <Table head={["Component", "Contents"]} align={["left", "left"]} rows={DATA_PACKAGE} />
        </div>
      </div>
    </>
  );
}

function Table({ head, rows, align }: { head: string[]; rows: (string | number)[][]; align: ("left" | "right")[] }) {
  return (
    <div className="mt-3 overflow-x-auto rounded-xl border border-line">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-surface text-xs font-semibold text-muted">
          <tr>
            {head.map((h, i) => (
              <th key={h} scope="col" className={`px-4 py-2.5 ${align[i] === "right" ? "text-right" : "text-left"}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={String(r[0])}>
              {r.map((c, i) => (
                <td key={i} className={`px-4 py-2.5 ${align[i] === "right" ? "tabular text-right" : ""} ${i === 0 ? "font-medium" : ""}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
