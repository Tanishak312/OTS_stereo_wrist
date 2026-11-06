import type { SupabaseClient } from "@supabase/supabase-js";
import { bucketAccessEmail, datasetReceivedEmail, sampleLinkEmail, samplePreparingEmail, sendEmail } from "./email";
import { formatSize, type RequestKind } from "./selection";

// How a request reaches the customer. Nothing here touches R2:
//   Ego-centric sample   the Google Drive folder, emailed right after submit.
//   Head + wrist sample  a note that it's being prepared; an admin later emails
//                        the keys of a shared R2 bucket from the request page.
//   Full dataset         a confirmation right after submit; an admin fills an R2
//                        bucket by hand, then emails its keys from the request page.

/** The R2 account the customers' buckets live in (override with R2_ENDPOINT). */
const DEFAULT_R2_ENDPOINT = "https://fba1fd7178f04a07c2c459f00a47a625.r2.cloudflarestorage.com";
const r2Endpoint = () => process.env.R2_ENDPOINT?.trim() || DEFAULT_R2_ENDPOINT;

/** The Google Drive folder of the Ego-centric sample. Throws with the setting to fix. */
function sampleDriveUrl(): string {
  const url = process.env.SAMPLE_DRIVE_URL_EGO?.trim();
  if (!url || !/^https:\/\//.test(url)) throw new Error("SAMPLE_DRIVE_URL_EGO is not set in .env, so there is no Drive link to send");
  return url;
}

export type CustomerEmailRequest = { token: string; kind: RequestKind; email: string; name: string; setup: string; hours: number; bytes: number | null };

/**
 * The email every request gets on its own: the Drive link for an Ego-centric sample, a
 * "being prepared" note for a head + wrist one, the confirmation for a dataset.
 * Records the outcome (ots_record_customer_email).
 * Returns why it failed, or null. Never throws: the request is already saved,
 * so a failed email must not turn into an error on the kiosk.
 */
export async function emailCustomer(client: SupabaseClient, req: CustomerEmailRequest): Promise<string | null> {
  const tag = `[emailCustomer] ${req.token}`;
  let emailId: string | null = null;
  let error: string | null = null;
  try {
    emailId = await sendEmail(
      req.kind === "dataset"
        ? datasetReceivedEmail({ to: req.email, name: req.name, token: req.token, hours: req.hours, size: req.bytes ? formatSize(req.bytes) : null })
        : req.setup === "head_wrist"
          ? samplePreparingEmail({ to: req.email, name: req.name, token: req.token })
          : sampleLinkEmail({ to: req.email, name: req.name, link: sampleDriveUrl() }),
    );
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    console.error(`${tag}: email failed: ${error}`);
  }
  const rec = await client.rpc("ots_record_customer_email", { p_token: req.token, p_email_id: emailId, p_error: error });
  if (rec.error) console.error(`${tag}: could not record the outcome`, rec.error.code, rec.error.message);
  return error;
}

export type BucketAccess = { bucket: string; accessKeyId: string; secret: string };

/** What an admin typed, tidied up. Pasted keys often pick up spaces. */
export const cleanAccess = (a: BucketAccess): BucketAccess => ({
  bucket: a.bucket.trim().toLowerCase(),
  accessKeyId: a.accessKeyId.trim(),
  secret: a.secret.trim(),
});

/** Returns what's wrong with the fields, or null. */
export function validateAccess(a: BucketAccess): string | null {
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(a.bucket)) return "Enter the bucket name only: lowercase letters, digits and hyphens.";
  if (!/^[A-Za-z0-9]{16,128}$/.test(a.accessKeyId)) return "That doesn't look like an R2 access key ID. Copy it from the token's S3 credentials.";
  if (!/^\S{16,128}$/.test(a.secret)) return "That doesn't look like an R2 secret access key. Copy it from the token's S3 credentials.";
  return null;
}

/** Emails the customer their bucket's keys. Throws with the reason if it doesn't go out; the secret is not kept anywhere. */
export async function emailBucketAccess(
  req: { token: string; kind: RequestKind; email: string; name: string; hours: number; bytes: number | null },
  access: BucketAccess,
): Promise<void> {
  await sendEmail(
    bucketAccessEmail({
      to: req.email,
      name: req.name,
      token: req.token,
      // A sample's bucket is shared, so what it holds isn't what this request matched.
      summary: req.kind === "sample" ? null : { hours: req.hours, size: req.bytes ? formatSize(req.bytes) : null },
      endpoint: r2Endpoint(),
      ...access,
    }),
  );
}
