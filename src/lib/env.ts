// Only the anon key is ever read. The service-role key in .env is
// deliberately unused: kiosk writes go through submit_ots_request() and admin
// writes through set_ots_request_status(), both guarded inside Postgres.

export function anonKey(): string {
  const key = process.env.SUPABASE_ANON_PUBLIC ?? process.env.SUPABASE_ANON_KEY;
  if (!key) throw new Error("SUPABASE_ANON_PUBLIC is not set in .env");
  return key;
}

export function supabaseUrl(): string {
  if (process.env.SUPABASE_URL) return process.env.SUPABASE_URL;
  // Fall back to the project ref embedded in the anon JWT. atob, not Buffer,
  // so this also runs in the edge middleware.
  const part = anonKey().split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
  const payload = JSON.parse(atob(part + "=".repeat((4 - (part.length % 4)) % 4)));
  if (!payload.ref) throw new Error("Set SUPABASE_URL in .env; the anon key has no project ref.");
  return `https://${payload.ref}.supabase.co`;
}
