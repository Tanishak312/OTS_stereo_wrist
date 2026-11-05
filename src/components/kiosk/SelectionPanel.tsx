"use client";

import { DATASET, SETUP_BY_ID } from "@/lib/catalog";
import { totals } from "@/lib/inventory";
import { useCountUp } from "@/lib/motion";
import { difficultySummary, environmentsList, formatHoursFine, matchingHours, skillsSummary, type Selection } from "@/lib/selection";
import { useInventory } from "./InventoryContext";

/**
 * What the visitor has picked so far: the one card on the left of every step,
 * always the same shape, so moving between steps only changes its values. A
 * step not reached yet shows a dash. On a phone only the hours line shows; the
 * bottom bar carries the rest.
 */
export function SelectionPanel({ sel, step, sample = false }: { sel: Selection; step: 1 | 2 | 3 | 4 | 5; sample?: boolean }) {
  const inv = useInventory();
  const setup = sel.setup ? SETUP_BY_ID[sel.setup] : null;
  // Step 1 has no environments yet, so its number is what the setup holds. A sample is a fixed folder.
  const hours = sample ? DATASET.sampleHours : step === 1 ? (setup ? totals(inv, { setup: setup.id }).hours : 0) : matchingHours(sel, inv);
  const shown = useCountUp(hours, { duration: 500 });

  const rows: [string, string][] = [
    ["Capture setup", setup?.name ?? "—"],
    ["Environments", sample ? "All environments" : step >= 2 ? environmentsList(sel) : "—"],
    ["Skills", sample ? "All skills" : step >= 3 ? skillsSummary(sel, inv) : "—"],
  ];
  // Head + wrist recordings aren't graded.
  if (!setup || setup.graded) rows.push(["Difficulty", sample ? "All levels" : step >= 3 ? difficultySummary(sel) : "—"]);

  const note =
    sample || !setup
      ? null
      : inv.source !== "live"
        ? "Estimate. We'll confirm the exact hours with your delivery."
        : step >= 2 && sel.environments.length > 0 && hours <= 0
          ? "Nothing matches these picks. Widen your environments or skills."
          : null;

  return (
    <div className="mt-4 rounded-2xl border border-[#ececec] bg-surface px-5 py-4 lg:mt-6 lg:rounded-[22px] lg:px-6 lg:py-6">
      <div className="flex items-center justify-between gap-4 lg:block" aria-live="polite">
        <p className="eyebrow text-[12px] tracking-[0.2em] text-muted lg:font-sans lg:text-[14px] lg:font-medium lg:tracking-[0.1em] lg:text-[#4b5563]">
          {sample ? "Free sample" : "Your selection"}
        </p>
        <p className="tabular whitespace-nowrap lg:mt-2">
          <span className="text-[34px] leading-none text-brand lg:text-[48px]">{setup ? formatHoursFine(shown) : "—"}</span>
          <span className="ml-1.5 text-[16px] text-ink lg:text-[20px]">hours</span>
        </p>
      </div>
      {note && <p className="mt-2 text-[13px] text-muted lg:text-[14px]">{note}</p>}
      <dl className="mt-4 hidden gap-4 border-t border-line pt-4 md:grid md:grid-cols-2 lg:mt-5 lg:block lg:space-y-4 lg:pt-5">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-[14px] text-muted">{label}</dt>
            <dd className={`mt-0.5 text-[16px] leading-snug ${value === "—" ? "text-subtle" : "font-medium text-ink"}`}>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
