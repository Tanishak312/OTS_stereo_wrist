"use server";

import { kioskClient } from "@/lib/supabase";
import { emailCustomer } from "@/lib/delivery";
import { loadInventory } from "@/lib/inventory-server";
import { activeEnvironments, matchingBytes, matchingHours, pickedSkills, requestBreakdown, validatePayload, type RequestPayload } from "@/lib/selection";

export type SubmitResult = { ok: true; token: string } | { ok: false; error: string };

export async function submitRequest(payload: RequestPayload): Promise<SubmitResult> {
  const invalid = validatePayload(payload);
  if (invalid) return { ok: false, error: invalid };

  let client;
  try {
    client = kioskClient();
  } catch (e) {
    console.error("[submitRequest] config", e);
    return { ok: false, error: "The kiosk is not connected to the request system. Please tell the booth team." };
  }

  // Hours are recomputed here from the episode index rather than trusted from the browser.
  const inventory = await loadInventory();
  const hours = matchingHours(payload, inventory);
  if (hours <= 0) {
    return { ok: false, error: "No recordings match these choices yet. Go back and widen your environments or tasks." };
  }
  const wholeHours = Math.max(1, Math.round(hours)); // the column is whole hours
  // Kept on a full-dataset request: what the admin fills the bucket against. A sample is a fixed Drive folder.
  const dataset = payload.kind === "dataset";
  const bytes = dataset ? Math.round(matchingBytes(payload, inventory)) : null;

  const { data, error } = await client.rpc("submit_ots_request", {
    p_kind: payload.kind,
    p_setup: payload.setup,
    p_environments: activeEnvironments(payload),
    // The column holds every skill named; which environment each belongs to is in the breakdown.
    p_skills: pickedSkills(payload),
    p_difficulties: payload.difficulties,
    p_matching_hours: wholeHours,
    p_full_name: payload.fullName.trim(),
    p_email: payload.email.trim(),
    p_phone: payload.phone.trim() || null,
    p_company: payload.company.trim() || null,
    p_source: "kiosk",
    p_matching_bytes: bytes,
    p_breakdown: dataset ? requestBreakdown(payload, inventory) : null,
  });

  if (error || typeof data !== "string") {
    // Log the code and message only: the error never carries the arguments, but keep it that way.
    console.error("[submitRequest] rpc", error?.code, error?.message);
    return {
      ok: false,
      error: "We couldn't send your request just now. Your details are still here, so please try again.",
    };
  }
  // The request is saved whatever happens here; a failed email shows on its admin page.
  await emailCustomer(client, {
    token: data,
    kind: payload.kind,
    email: payload.email.trim(),
    name: payload.fullName.trim(),
    setup: payload.setup as string,
    hours: wholeHours,
    bytes,
  });
  return { ok: true, token: data };
}
