import { needsReview, type OtsRequest } from "@/lib/status";

// Status filter options. Dataset and sample requests have different
// lifecycles, so options are framed around what the admin is looking for.
export const STATUS_FILTERS: { id: string; label: string; match: (r: OtsRequest) => boolean }[] = [
  { id: "open", label: "Datasets to review", match: needsReview },
  { id: "approved", label: "Access sent", match: (r) => r.status === "approved" },
  { id: "rejected", label: "Rejected", match: (r) => r.status === "rejected" },
  { id: "pending_delivery", label: "Samples pending delivery", match: (r) => r.kind === "sample" && r.status === "submitted" },
  { id: "sample_sent", label: "Samples sent", match: (r) => r.status === "sample_sent" },
];
