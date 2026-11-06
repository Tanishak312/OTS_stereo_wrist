import Link from "next/link";
import { KindBadge, StatusPill } from "@/components/admin/StatusPill";
import { DIFFICULTY_BY_ID, SETUP_BY_ID, deliveryContents, domainName, skillName } from "@/lib/catalog";
import { formatDateTime, loadRequest } from "@/lib/admin-data";
import { loadInventory } from "@/lib/inventory-server";
import { formatHours, formatHoursFine, formatSize, requestBreakdown, type BreakdownEnvironment } from "@/lib/selection";
import { sampleByBucket, statusView } from "@/lib/status";
import { CustomerEmail, ReviewPanel } from "./ReviewPanel";

type Params = { token: string };

export async function generateMetadata({ params }: { params: Promise<Params> }) {
  const { token } = await params;
  return { title: `${decodeURIComponent(token)} · OTS admin` };
}

const DONE_COPY: Record<string, string> = {
  rejected: "Request rejected.",
  in_review: "Marked as in review.",
  sample_sent: "Sample marked as sent.",
  email_sent: "Email sent.",
  access_sent: "Bucket access emailed.",
};

export default async function RequestPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<{ done?: string }>;
}) {
  const token = decodeURIComponent((await params).token);
  const { done } = await searchParams;
  const loaded = await loadRequest(token);

  if (loaded.data === null) {
    return (
      <div role="alert" className="rounded-xl border border-warn/30 bg-warn-50 p-5 text-sm">
        <p className="font-semibold">Can&rsquo;t show {token}</p>
        <p className="mt-1">{loaded.error}</p>
      </div>
    );
  }

  const { request: r, events } = loaded.data;
  if (!r) {
    return (
      <div className="py-16 text-center">
        <p className="font-semibold">No request with token {token}</p>
        <Link href="/admin" className="mt-2 inline-block text-sm font-medium text-brand hover:underline">
          Back to requests
        </Link>
      </div>
    );
  }

  const doneMsg = done ? DONE_COPY[done] : undefined;
  const dataset = r.kind === "dataset";
  const bucketSample = sampleByBucket(r);
  const inventory = await loadInventory();
  // A request keeps the numbers from when it was made; older ones have none, so they use today's.
  const breakdown = dataset
    ? (r.breakdown ?? requestBreakdown({ setup: r.capture_setup, environments: r.environments, skills: r.skills.length ? Object.fromEntries(r.environments.map((e) => [e, r.skills])) : {}, difficulties: r.difficulties }, inventory))
    : [];
  const contents = deliveryContents(SETUP_BY_ID[r.capture_setup], inventory.mcap).delivery;

  return (
    <>
      <Link href="/admin" className="text-sm font-medium text-brand hover:underline">
        &larr; All requests
      </Link>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{r.token}</h1>
        <KindBadge kind={r.kind} />
        <StatusPill status={r.status} kind={r.kind} />
        {r.is_demo && <span className="rounded bg-surface px-1.5 py-0.5 text-xs text-muted">demo data</span>}
      </div>
      <p className="mt-1 text-sm text-muted">Submitted {formatDateTime(r.created_at)} from the {r.source}</p>

      {doneMsg && (
        <p role="status" className="mt-4 rounded-lg bg-success-50 px-4 py-3 text-sm font-medium text-success">
          {doneMsg}
        </p>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* min-w-0: lets the wide breakdown scroll inside its own box instead of widening the page. */}
        <div className="min-w-0 space-y-6">
          <section className="rounded-xl border border-line">
            <h2 className="border-b border-line px-5 py-3 text-sm font-semibold">Customer</h2>
            <dl className="grid gap-x-6 gap-y-4 p-5 sm:grid-cols-2">
              <Item label="Name" value={r.full_name} />
              <Item
                label="Email"
                value={
                  <a href={`mailto:${r.email}`} className="text-brand hover:underline">
                    {r.email}
                  </a>
                }
              />
              <Item label="Phone" value={r.phone ?? "—"} />
              <Item label="Company" value={r.company ?? "—"} />
            </dl>
          </section>

          <section className="rounded-xl border border-line">
            <h2 className="border-b border-line px-5 py-3 text-sm font-semibold">What they asked for</h2>
            <dl className="grid gap-x-6 gap-y-4 p-5 sm:grid-cols-2">
              <Item label="Capture setup" value={SETUP_BY_ID[r.capture_setup]?.name ?? r.capture_setup} />
              <Item label="Matching hours (when requested)" value={`${formatHours(r.matching_hours)} h`} />
              {dataset && <Item label="Size (when requested)" value={r.matching_bytes ? `≈ ${formatSize(r.matching_bytes)}` : "—"} />}
              <Item label="Delivery" value={dataset ? `${contents} · R2 bucket` : bucketSample ? `${contents} · shared R2 bucket` : "MCAP files · Google Drive folder, the same for everyone"} />
              <Item
                label="Difficulty"
                value={r.difficulties.length ? r.difficulties.map((d) => DIFFICULTY_BY_ID[d]?.name ?? d).join(", ") : "Balanced mix (all)"}
              />
            </dl>
            <div className="border-t border-line p-5">
              <p className="text-xs font-medium text-muted">Environments ({r.environments.length})</p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {r.environments.map((e) => (
                  <li key={e} className="rounded-full bg-surface px-3 py-1 text-sm">
                    {domainName(e)}
                  </li>
                ))}
              </ul>
              {/* A dataset picks skills per environment: the table below has them. */}
              {!dataset && (
                <>
              <p className="mt-4 text-xs font-medium text-muted">Manipulation skills</p>
              {r.skills.length ? (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {r.skills.map((s) => (
                    <li key={s} className="rounded-full bg-surface px-3 py-1 text-sm">
                      {skillName(s)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-sm">All tasks (no skill filter)</p>
              )}
                </>
              )}
            </div>
          </section>

          {dataset && <Breakdown rows={breakdown} />}
        </div>

        <div className="min-w-0 space-y-6">
          <section className="rounded-xl border border-line p-5">
            <h2 className="text-sm font-semibold">Delivery</h2>
            {r.review_note && (
              <p className="mt-2 rounded-lg bg-surface px-3 py-2 text-sm">
                <span className="text-xs text-muted">Latest note</span>
                <span className="mt-0.5 block">{r.review_note}</span>
              </p>
            )}
            {/* Once a head + wrist sample has its keys, a "we're preparing it" email would only confuse. */}
            {!(bucketSample && r.access_sent_at) && (
              <CustomerEmail
                token={r.token}
                what={dataset ? "Confirmation" : bucketSample ? "Preparing notice" : "Google Drive link"}
                sentAt={r.customer_emailed_at ? formatDateTime(r.customer_emailed_at) : null}
                error={r.customer_email_error}
              />
            )}
            <div className="mt-4 border-t border-line pt-4 empty:hidden">
              <ReviewPanel
                token={r.token}
                status={r.status}
                kind={r.kind}
                bucketSample={bucketSample}
                email={r.email}
                access={r.access_sent_at ? { bucket: r.access_bucket, keyId: r.access_key_id, sentAt: formatDateTime(r.access_sent_at) } : null}
              />
            </div>
          </section>

          <section className="rounded-xl border border-line p-5">
            <h2 className="text-sm font-semibold">History</h2>
            <ol className="mt-3 space-y-4">
              {events.map((e) => (
                <li key={e.id} className="border-l-2 border-line pl-3 text-sm">
                  <p className="font-medium">
                    {e.from_status && e.from_status !== e.to_status ? `${statusView(e.from_status, r.kind).label} → ` : ""}
                    {statusView(e.to_status, r.kind).label}
                  </p>
                  <p className="text-xs text-muted">
                    {formatDateTime(e.created_at)}
                    {e.actor_email ? ` · ${e.actor_email}` : e.from_status ? "" : " · kiosk"}
                  </p>
                  {e.note && <p className="mt-1 text-sm text-ink">{e.note}</p>}
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </>
  );
}

/** Environment, episodes, hours, size; skill rows line up under the same columns. */
const ROW = "grid grid-cols-[minmax(0,1fr)_64px_64px_72px] items-center gap-x-3 px-5";

function Numbers({ r }: { r: { episodes: number; hours: number; bytes: number } }) {
  return (
    <>
      <span className="tabular text-right">{r.episodes.toLocaleString("en-IN")}</span>
      <span className="tabular text-right">{formatHoursFine(r.hours)} h</span>
      <span className="tabular text-right">{r.bytes ? formatSize(r.bytes) : "—"}</span>
    </>
  );
}

/** What the bucket must hold: each environment on its own, with that environment's hours per skill. */
function Breakdown({ rows }: { rows: BreakdownEnvironment[] }) {
  const total = rows.reduce((t, e) => ({ episodes: t.episodes + e.episodes, hours: t.hours + e.hours, bytes: t.bytes + e.bytes }), { episodes: 0, hours: 0, bytes: 0 });
  return (
    <section className="rounded-xl border border-line">
      <h2 className="border-b border-line px-5 py-3 text-sm font-semibold">Per environment and skill</h2>
      <div className="overflow-x-auto">
        <div className="min-w-[480px] text-sm">
          <div className={`${ROW} border-b border-line bg-surface py-2 text-xs font-semibold text-muted`}>
            <span>Environment</span>
            <span className="text-right">Episodes</span>
            <span className="text-right">Hours</span>
            <span className="text-right">Size</span>
          </div>
          {rows.map((e) => (
            // Few environments: all open. After "Select all", closed so the list stays readable.
            <details key={e.domain} open={rows.length <= 5} className="group border-b border-line">
              <summary className={`${ROW} cursor-pointer list-none py-2.5 font-medium hover:bg-surface/60 [&::-webkit-details-marker]:hidden`}>
                <span>
                  <span aria-hidden="true" className="mr-1.5 inline-block text-xs text-muted transition-transform group-open:rotate-90">
                    ▸
                  </span>
                  {domainName(e.domain)}
                  <span className="ml-1.5 text-xs font-normal text-muted">{e.skills.length} skills</span>
                </span>
                <Numbers r={e} />
              </summary>
              <ul className="pb-2">
                {e.skills.map((s) => (
                  <li key={s.skill} className={`${ROW} py-1 text-muted`}>
                    <span className="pl-5 text-ink">{skillName(s.skill)}</span>
                    <Numbers r={s} />
                  </li>
                ))}
              </ul>
            </details>
          ))}
          <div className={`${ROW} py-2.5 font-semibold`}>
            <span>Total</span>
            <Numbers r={total} />
          </div>
        </div>
      </div>
    </section>
  );
}

function Item({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-muted">{label}</dt>
      <dd className="mt-1 text-sm break-words">{value}</dd>
    </div>
  );
}
