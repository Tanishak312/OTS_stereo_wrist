import { lookupTable } from "./catalog";
import type { BreakdownEnvironment } from "./selection";

export type RequestStatus = "submitted" | "in_review" | "approved" | "rejected" | "sample_sent";

export const STATUSES: { id: RequestStatus; label: string; tone: "info" | "warn" | "success" | "danger" | "neutral" }[] = [
  { id: "submitted", label: "New", tone: "warn" },
  { id: "in_review", label: "In review", tone: "info" },
  { id: "approved", label: "Approved", tone: "success" },
  { id: "rejected", label: "Rejected", tone: "danger" },
  { id: "sample_sent", label: "Sample sent", tone: "neutral" },
];

export const STATUS_BY_ID = lookupTable(STATUSES.map((s) => [s.id, s] as [string, (typeof STATUSES)[number]])) as Record<
  RequestStatus,
  (typeof STATUSES)[number]
>;

export type RequestKind = "dataset" | "sample";

/** Free samples skip approval, so a fresh one is waiting on delivery, not on review. */
export function statusView(status: RequestStatus, kind: RequestKind) {
  if (kind === "sample" && status === "submitted") return { label: "Pending delivery", tone: "info" as const };
  if (kind === "sample" && status === "sample_sent") return { label: "Sent", tone: "success" as const };
  // A dataset gets here only by emailing its bucket access (014_manual_delivery.sql).
  if (kind === "dataset" && status === "approved") return { label: "Access sent", tone: "success" as const };
  return { label: STATUS_BY_ID[status]?.label ?? status, tone: STATUS_BY_ID[status]?.tone ?? ("neutral" as const) };
}

/** A head + wrist sample has no Drive folder: its first email says it's being prepared, and an admin sends a shared bucket's keys later. */
export function sampleByBucket(r: { kind: RequestKind; capture_setup: string }) {
  return r.kind === "sample" && r.capture_setup === "head_wrist";
}

/**
 * The customer's answer to "Do you want this data for your model/robot training?":
 * short for the table, long for the request page. Requests from before it may carry
 * the earlier "for your lab" answer instead.
 */
export function intendedUse(r: { for_training?: boolean | null; for_own_lab?: boolean | null }) {
  if (r.for_training === true) return { short: "Training: Yes", long: "Yes, for model/robot training" };
  if (r.for_training === false) return { short: "Training: No", long: "No, not for model/robot training" };
  if (r.for_own_lab === true) return { short: "Own lab", long: "Own lab (asked before the training question)" };
  if (r.for_own_lab === false) return { short: "Licensing", long: "Licensing to others (asked before the training question)" };
  return { short: null, long: "Not asked (request made before this question)" };
}

/** Dataset requests that still need an admin decision. */
export function needsReview(r: { kind: RequestKind; status: RequestStatus }) {
  return r.kind === "dataset" && (r.status === "submitted" || r.status === "in_review");
}

export type OtsRequest = {
  id: string;
  token: string;
  kind: "dataset" | "sample";
  status: RequestStatus;
  capture_setup: "ego" | "head_wrist";
  environments: string[];
  skills: string[];
  difficulties: ("easy" | "medium" | "hard")[];
  matching_hours: number;
  requested_hours: number | null;
  delivery_format: string;
  // From 014_manual_delivery.sql. Null on requests older than it.
  matching_bytes: number | null;
  breakdown: BreakdownEnvironment[] | null;
  customer_emailed_at: string | null;
  customer_email_error: string | null;
  access_bucket: string | null;
  access_key_id: string | null;
  access_sent_at: string | null;
  // From 016_intended_use.sql. Null on requests made before each question existed.
  for_training?: boolean | null;
  for_own_lab?: boolean | null;
  full_name: string;
  email: string;
  phone: string | null;
  company: string | null;
  source: string;
  is_demo: boolean;
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type OtsEvent = {
  id: number;
  from_status: RequestStatus | null;
  to_status: RequestStatus;
  note: string | null;
  actor_email: string | null;
  created_at: string;
};
