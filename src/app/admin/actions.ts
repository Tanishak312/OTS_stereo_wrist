"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { adminClient } from "@/lib/supabase";
import { cleanAccess, emailBucketAccess, emailCustomer, validateAccess } from "@/lib/delivery";
import type { OtsRequest, RequestStatus } from "@/lib/status";

export type ActionState = { error: string | null };

function safeNext(next: FormDataEntryValue | null): string {
  const n = typeof next === "string" ? next : "";
  // Only same-site admin paths; never an absolute URL.
  return n.startsWith("/admin") && !n.startsWith("//") ? n : "/admin";
}

export async function signIn(_prev: ActionState, form: FormData): Promise<ActionState> {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password." };

  const supabase = await adminClient();
  const { data: auth, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: "That email and password don't match an admin account." };

  // A failed check and a "no" are different problems; don't report one as the other.
  const { data: isAdmin, error: checkError } = await supabase.rpc("is_ots_admin");
  if (checkError) {
    console.error("[signIn] is_ots_admin failed", { user: auth.user?.id, code: checkError.code, message: checkError.message });
    await supabase.auth.signOut();
    return {
      error:
        checkError.code === "PGRST202" || checkError.code === "42883"
          ? "Admin check isn't set up in Supabase yet. Run supabase/001_init.sql, then try again."
          : `Couldn't check admin access (${checkError.code ?? "error"}: ${checkError.message}).`,
    };
  }
  if (!isAdmin) {
    console.warn("[signIn] signed in but not in ots_admins", { user: auth.user?.id, email: auth.user?.email });
    await supabase.auth.signOut();
    return {
      error: `${auth.user?.email ?? "This account"} can sign in, but it isn't on the OTS admin list yet. Add it to ots_admins (see README), then try again.`,
    };
  }
  redirect(safeNext(form.get("next")));
}

export async function signOut() {
  const supabase = await adminClient();
  await supabase.auth.signOut();
  redirect("/admin/login");
}

// Not "approved": a dataset gets there by sending its bucket access (sendBucketAccess).
const ALLOWED: RequestStatus[] = ["in_review", "rejected", "sample_sent"];

export async function changeStatus(_prev: ActionState, form: FormData): Promise<ActionState> {
  const token = String(form.get("token") ?? "");
  const status = String(form.get("status") ?? "") as RequestStatus;
  const note = String(form.get("note") ?? "").trim();

  if (!ALLOWED.includes(status)) return { error: "Unknown action." };
  if (status === "rejected" && !note) return { error: "Add a note saying why this request is rejected." };

  const supabase = await adminClient();
  const { error } = await supabase.rpc("set_ots_request_status", {
    p_token: token,
    p_status: status,
    p_note: note || null,
  });
  if (error) {
    console.error("[changeStatus]", error);
    // Messages raised in set_ots_request_status are written for people.
    return { error: error.message || "Couldn't update the request. Try again." };
  }

  revalidatePath("/admin");
  revalidatePath(`/admin/requests/${token}`);
  redirect(`/admin/requests/${encodeURIComponent(token)}?done=${status}`);
}

/** Row-level security returns nothing to anyone who isn't an admin, so a found request also means an admin asked. */
async function loadForEmail(token: string) {
  const supabase = await adminClient();
  const { data, error } = await supabase.from("ots_requests").select("*").eq("token", token).maybeSingle();
  if (error) console.error("[loadForEmail]", token, error.code, error.message);
  return { supabase, request: data as OtsRequest | null };
}

/** Sends the automatic email again: the Drive link for a sample, the confirmation for a dataset. */
export async function resendCustomerEmail(_prev: ActionState, form: FormData): Promise<ActionState> {
  const token = String(form.get("token") ?? "");
  const { supabase, request: r } = await loadForEmail(token);
  if (!r) return { error: `Couldn't load ${token}.` };

  const failed = await emailCustomer(supabase, {
    token: r.token,
    kind: r.kind,
    email: r.email,
    name: r.full_name,
    setup: r.capture_setup,
    hours: r.matching_hours,
    bytes: r.matching_bytes,
  });
  revalidatePath("/admin");
  revalidatePath(`/admin/requests/${token}`);
  if (failed) return { error: `It didn't go out: ${failed}` };
  redirect(`/admin/requests/${encodeURIComponent(token)}?done=email_sent`);
}

/**
 * Emails the customer the keys to the bucket an admin filled, then marks the
 * request as done. The email comes first: a failure leaves the request as it
 * was, and the form keeps what was typed. The secret goes in the email and
 * nowhere else; it's never stored or logged.
 */
export async function sendBucketAccess(_prev: ActionState, form: FormData): Promise<ActionState> {
  const token = String(form.get("token") ?? "");
  const access = cleanAccess({
    bucket: String(form.get("bucket") ?? ""),
    accessKeyId: String(form.get("accessKeyId") ?? ""),
    secret: String(form.get("secret") ?? ""),
  });
  const invalid = validateAccess(access);
  if (invalid) return { error: invalid };

  const { supabase, request: r } = await loadForEmail(token);
  if (!r) return { error: `Couldn't load ${token}.` };
  if (r.kind !== "dataset" || r.status === "rejected") return { error: `${token} can't be given access.` };

  try {
    await emailBucketAccess({ token: r.token, email: r.email, name: r.full_name, hours: r.matching_hours, bytes: r.matching_bytes }, access);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.error("[sendBucketAccess]", token, reason);
    return { error: `The email didn't go out, so nothing changed: ${reason}` };
  }

  const { error } = await supabase.rpc("ots_record_access_sent", { p_token: token, p_bucket: access.bucket, p_access_key_id: access.accessKeyId });
  if (error) {
    console.error("[sendBucketAccess] record", token, error.code, error.message);
    return { error: `The email reached ${r.email}, but it couldn't be recorded here: ${error.message}` };
  }
  revalidatePath("/admin");
  revalidatePath(`/admin/requests/${token}`);
  redirect(`/admin/requests/${encodeURIComponent(token)}?done=access_sent`);
}
