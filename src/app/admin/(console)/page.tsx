import Link from "next/link";
import { Suspense } from "react";
import { KindBadge, StatusPill } from "@/components/admin/StatusPill";
import { DOMAIN_BY_SLUG, SETUP_BY_ID } from "@/lib/catalog";
import { formatDate, formatTime, loadRequests } from "@/lib/admin-data";
import { formatHours, formatSize } from "@/lib/selection";
import { intendedUse, needsReview, type OtsRequest } from "@/lib/status";
import { STATUS_FILTERS } from "./filters";
import { FilterBar } from "./FilterBar";

export const metadata = { title: "Requests · OTS admin" };

type Search = { q?: string; status?: string; kind?: string; env?: string };

function applyFilters(rows: OtsRequest[], s: Search): OtsRequest[] {
  const q = s.q?.trim().toLowerCase();
  return rows.filter((r) => {
    if (s.kind && r.kind !== s.kind) return false;
    if (s.env && !r.environments.includes(s.env)) return false;
    if (s.status && !STATUS_FILTERS.find((f) => f.id === s.status)?.match(r)) return false;
    if (q && ![r.token, r.full_name, r.email, r.company ?? ""].some((v) => v.toLowerCase().includes(q))) return false;
    return true;
  });
}

function filterHref(current: Search, patch: Partial<Search>): string {
  const next = new URLSearchParams();
  Object.entries({ ...current, ...patch }).forEach(([k, v]) => v && next.set(k, v));
  return `/admin${next.size ? `?${next}` : ""}`;
}

export default async function RequestsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const loaded = await loadRequests();

  if (loaded.data === null) {
    return (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">Requests</h1>
        <div role="alert" className="mt-6 rounded-xl border border-warn/30 bg-warn-50 p-5 text-sm text-ink">
          <p className="font-semibold">Can&rsquo;t show requests</p>
          <p className="mt-1">{loaded.error}</p>
        </div>
      </>
    );
  }

  const { rows, truncated } = loaded.data;
  const visible = applyFilters(rows, search);
  const count = (fn: (r: OtsRequest) => boolean) => rows.filter(fn).length;
  // Review KPIs count full-dataset requests only; free samples skip approval.
  const kpis = [
    { label: "Datasets to review", value: count(needsReview), href: filterHref({}, { status: "open" }), icon: "clock" },
    { label: "Access sent", value: count((r) => r.kind === "dataset" && r.status === "approved"), href: filterHref({}, { status: "approved" }), icon: "check" },
    { label: "Datasets rejected", value: count((r) => r.kind === "dataset" && r.status === "rejected"), href: filterHref({}, { status: "rejected" }), icon: "x" },
    { label: "Samples to send", value: count((r) => r.kind === "sample" && r.status === "submitted"), href: filterHref({}, { status: "pending_delivery" }), icon: "clock" },
    { label: "Free samples", value: count((r) => r.kind === "sample"), href: filterHref({}, { kind: "sample" }), icon: "list" },
  ] as const;

  const chips: { label: string; key: keyof Search }[] = [];
  if (search.q) chips.push({ label: `“${search.q}”`, key: "q" });
  if (search.kind) chips.push({ label: search.kind === "sample" ? "Sample" : "Dataset", key: "kind" });
  if (search.env) chips.push({ label: DOMAIN_BY_SLUG[search.env]?.name ?? search.env, key: "env" });
  if (search.status)
    chips.push({ label: STATUS_FILTERS.find((f) => f.id === search.status)?.label ?? search.status, key: "status" });

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Requests</h1>
      <p className="mt-1 text-sm text-muted">Full-dataset requests wait for you to fill a bucket and send its access. So do head + wrist samples, from one shared bucket. Ego-centric samples go out by themselves.</p>

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {kpis.map((k) => (
          <Link key={k.label} href={k.href} className="flex items-center gap-4 rounded-xl border border-line bg-white p-4 hover:border-subtle">
            <KpiIcon icon={k.icon} />
            <span>
              <span className="tabular block text-2xl font-semibold">{k.value}</span>
              <span className="block text-sm text-muted">{k.label}</span>
            </span>
          </Link>
        ))}
      </div>

      <div className="mt-6">
        <Suspense>
          <FilterBar />
        </Suspense>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted">
        <span className="tabular">
          {visible.length === rows.length ? `${rows.length} requests` : `${visible.length} of ${rows.length} requests`}
        </span>
        {chips.map((c) => (
          <Link
            key={c.key}
            href={filterHref(search, { [c.key]: undefined })}
            className="inline-flex items-center gap-1 rounded-full bg-surface px-2.5 py-1 text-xs font-medium text-ink hover:bg-line"
            aria-label={`Remove filter ${c.label}`}
          >
            {c.label} <span aria-hidden="true">×</span>
          </Link>
        ))}
        {chips.length > 1 && (
          <Link href="/admin" className="text-xs font-medium text-brand hover:underline">
            Clear all
          </Link>
        )}
        {truncated && <span className="text-xs text-warn">Showing the newest 1,000 only.</span>}
      </div>

      <div className="mt-3 overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[1040px] border-collapse text-sm">
          <thead className="bg-surface text-left text-xs font-semibold text-muted">
            <tr>
              <th scope="col" className="sticky left-0 bg-surface px-4 py-3">Token</th>
              <th scope="col" className="px-4 py-3">Submitted</th>
              <th scope="col" className="px-4 py-3">Type</th>
              <th scope="col" className="px-4 py-3">Setup</th>
              <th scope="col" className="px-4 py-3">Environments</th>
              <th scope="col" className="px-4 py-3 text-right">Hours</th>
              <th scope="col" className="px-4 py-3 text-right">Size</th>
              <th scope="col" className="px-4 py-3">Customer</th>
              <th scope="col" className="px-4 py-3">Status</th>
              <th scope="col" className="px-4 py-3"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {visible.map((r) => (
              <tr key={r.id} className="hover:bg-surface/60">
                <th scope="row" className="sticky left-0 bg-white px-4 py-3 text-left font-semibold whitespace-nowrap">
                  {r.token}
                </th>
                <td className="tabular px-4 py-3 whitespace-nowrap">
                  {formatTime(r.created_at)}
                  <span className="block text-xs text-muted">{formatDate(r.created_at)}</span>
                </td>
                <td className="px-4 py-3">
                  <KindBadge kind={r.kind} />
                  {intendedUse(r).short && (
                    <span className="mt-1 block text-xs whitespace-nowrap text-muted">{intendedUse(r).short}</span>
                  )}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">{SETUP_BY_ID[r.capture_setup]?.name ?? r.capture_setup}</td>
                <td className="max-w-64 px-4 py-3">
                  <span className="line-clamp-2">
                    {r.environments.slice(0, 2).map((e) => DOMAIN_BY_SLUG[e]?.name ?? e).join(", ")}
                    {r.environments.length > 2 && <span className="text-muted"> +{r.environments.length - 2} more</span>}
                  </span>
                </td>
                <td className="tabular px-4 py-3 text-right whitespace-nowrap">{formatHours(r.matching_hours)} h</td>
                <td className="tabular px-4 py-3 text-right whitespace-nowrap">{r.matching_bytes ? formatSize(r.matching_bytes) : "—"}</td>
                <td className="px-4 py-3">
                  <span className="block font-medium">{r.full_name}</span>
                  <span className="block text-xs text-muted">{r.email}</span>
                </td>
                <td className="px-4 py-3">
                  <StatusPill status={r.status} kind={r.kind} />
                  {r.customer_email_error && <span className="mt-1 block text-xs font-medium text-danger">Email failed</span>}
                </td>
                <td className="px-4 py-3 text-right">
                  <Link href={`/admin/requests/${encodeURIComponent(r.token)}`} className="font-medium text-brand hover:underline">
                    {needsReview(r) ? "Review" : "View"}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {visible.length === 0 && (
          <div className="px-6 py-12 text-center">
            {rows.length === 0 ? (
              <>
                <p className="font-semibold">No requests yet</p>
                <p className="mt-1 text-sm text-muted">Requests submitted at the kiosk show up here. Open the kiosk at / to send a test one.</p>
              </>
            ) : (
              <>
                <p className="font-semibold">No requests match these filters</p>
                <Link href="/admin" className="mt-2 inline-block text-sm font-medium text-brand hover:underline">
                  Clear filters
                </Link>
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function KpiIcon({ icon }: { icon: "list" | "clock" | "check" | "x" }) {
  const tone = { list: "bg-brand-50 text-brand", clock: "bg-warn-50 text-warn", check: "bg-success-50 text-success", x: "bg-danger-50 text-danger" }[icon];
  return (
    <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${tone}`} aria-hidden="true">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        {icon === "list" && <path d="M8 7h11M8 12h11M8 17h11M4.5 7h.01M4.5 12h.01M4.5 17h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
        {icon === "clock" && (
          <>
            <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="2" />
            <path d="M12 8v4l3 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </>
        )}
        {icon === "check" && (
          <>
            <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="2" />
            <path d="m8.5 12 2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </>
        )}
        {icon === "x" && (
          <>
            <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="2" />
            <path d="m9.5 9.5 5 5m0-5-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </>
        )}
      </svg>
    </span>
  );
}
