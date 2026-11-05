import { statusView, type RequestKind, type RequestStatus } from "@/lib/status";

const TONE = {
  info: "bg-info-50 text-info",
  warn: "bg-warn-50 text-warn",
  success: "bg-success-50 text-success",
  danger: "bg-danger-50 text-danger",
  neutral: "bg-surface text-ink",
} as const;

// Colour is paired with a distinct shape per status so it never carries meaning alone.
const SHAPE: Record<RequestStatus, React.ReactNode> = {
  submitted: <circle cx="8" cy="8" r="3.5" fill="currentColor" />,
  in_review: <path d="M8 3a5 5 0 1 0 0 10V3Z" fill="currentColor" />,
  approved: <path d="m4.5 8.3 2.3 2.2 4.7-5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />,
  rejected: <path d="m5 5 6 6m0-6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />,
  sample_sent: <path d="M3 8h8m-3-3 3 3-3 3" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />,
};

export function StatusPill({ status, kind }: { status: RequestStatus; kind: RequestKind }) {
  const s = statusView(status, kind);
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap ${TONE[s.tone]}`}>
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
        {SHAPE[status]}
      </svg>
      {s.label}
    </span>
  );
}

export function KindBadge({ kind }: { kind: "dataset" | "sample" }) {
  return kind === "sample" ? (
    <span className="inline-flex rounded-md border border-line px-2 py-0.5 text-xs font-medium whitespace-nowrap text-ink">
      Sample
    </span>
  ) : (
    <span className="inline-flex rounded-md bg-ink px-2 py-0.5 text-xs font-medium whitespace-nowrap text-white">Dataset</span>
  );
}
