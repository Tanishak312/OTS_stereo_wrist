import { adminClient } from "./supabase";
import type { OtsEvent, OtsRequest } from "./status";

export type Loaded<T> = { data: T; error: null } | { data: null; error: string };

// Kiosk volumes are small; load the newest rows and filter in memory so the
// KPI cards and the table always agree.
const LIST_LIMIT = 1000;

function explain(error: { code?: string; message?: string }): string {
  if (error.code === "42P01" || error.code === "PGRST205" || error.code === "PGRST202") {
    return "The OTS tables aren't set up in Supabase yet. Run supabase/001_init.sql in the Supabase SQL editor, then reload.";
  }
  if (error.code === "42501") return "Your account isn't on the OTS admin list.";
  return error.message || "Couldn't load requests from Supabase.";
}

export async function loadRequests(): Promise<Loaded<{ rows: OtsRequest[]; truncated: boolean }>> {
  const supabase = await adminClient();
  const { data, error } = await supabase
    .from("ots_requests")
    .select("*")
    .eq("is_demo", false) // The sample rows from 900_demo_seed.sql aren't real requests.
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (error) return { data: null, error: explain(error) };
  return { data: { rows: data as OtsRequest[], truncated: data.length === LIST_LIMIT }, error: null };
}

export async function loadRequest(token: string): Promise<Loaded<{ request: OtsRequest | null; events: OtsEvent[] }>> {
  const supabase = await adminClient();
  const { data, error } = await supabase.from("ots_requests").select("*").eq("token", token).maybeSingle();
  if (error) return { data: null, error: explain(error) };
  if (!data) return { data: { request: null, events: [] }, error: null };

  const ev = await supabase
    .from("ots_request_events")
    .select("id, from_status, to_status, note, actor_email, created_at")
    .eq("request_id", data.id)
    .order("created_at", { ascending: true });
  if (ev.error) return { data: null, error: explain(ev.error) };
  return { data: { request: data as OtsRequest, events: ev.data as OtsEvent[] }, error: null };
}

export async function currentAdminEmail(): Promise<string | null> {
  const supabase = await adminClient();
  const { data } = await supabase.auth.getUser();
  return data.user?.email ?? null;
}

const IST = "Asia/Kolkata";

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", { timeZone: IST, hour: "2-digit", minute: "2-digit", hour12: false });
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { timeZone: IST, day: "numeric", month: "short" });
}

export function formatDateTime(iso: string): string {
  return `${formatDate(iso)}, ${formatTime(iso)} IST`;
}

export function todayIST(): string {
  return new Date().toLocaleDateString("en-IN", { timeZone: IST, day: "numeric", month: "short", year: "numeric" });
}
