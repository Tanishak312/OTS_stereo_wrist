// Outgoing email through Resend's HTTP API (no SDK needed).
//
// EMAIL_FROM must be an address on a domain verified in Resend. Until one is,
// Resend only accepts onboarding@resend.dev as sender and only delivers to the
// Resend account's own address; any other recipient is refused, and that
// refusal is recorded on the request for the admin to see.

const RESEND_URL = "https://api.resend.com/emails";
const DEFAULT_FROM = "Awign Robotics Data <onboarding@resend.dev>";

export type Email = { to: string; subject: string; html: string; text: string };

/** Sends one email. Returns Resend's message id; throws with a readable reason on failure. */
export async function sendEmail(msg: Email): Promise<string> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) throw new Error("RESEND_API_KEY is not set in .env");

  const res = await fetch(RESEND_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM?.trim() || DEFAULT_FROM,
      to: [msg.to],
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => null)) as { id?: string; message?: string; name?: string } | null;
  if (!res.ok || !body?.id) {
    throw new Error(`Resend ${res.status}: ${body?.message ?? body?.name ?? "no response body"}`);
  }
  return body.id;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const firstName = (name: string) => name.trim().split(/\s+/)[0] || "there";

const P = "margin:0 0 16px;font-size:15px;line-height:1.5;color:#4b5563";
const NOTE = "margin:20px 0 0;font-size:13px;line-height:1.5;color:#6b7280";
const CODE = "margin:0 0 16px;font-family:Menlo,Consolas,monospace;font-size:13px;line-height:1.5;background:#f5f7fa;border-radius:8px;padding:10px 12px;word-break:break-all";

/** The frame every email shares. `body` is HTML: escape what goes in it. */
function page(eyebrow: string, heading: string, body: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f5f7fa;font-family:Inter,Arial,sans-serif;color:#0b1220">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px">
<tr><td>
<p style="margin:0 0 4px;font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#0a5bd3">${esc(eyebrow)}</p>
<h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;font-weight:600">${esc(heading)}</h1>
${body}
</td></tr></table>
<p style="margin:16px 0 0;font-size:12px;color:#9ca3af">Awign Robotics Data</p>
</td></tr></table></body></html>`;
}

/** Ego-centric free sample: the Google Drive folder, the same one for everyone. */
export function sampleLinkEmail(p: { to: string; name: string; link: string }): Email {
  const first = firstName(p.name);
  const intro = "Your free sample of the Awign stereo egocentric dataset is ready: MCAP recordings from across our environments, about 50 hours in all.";
  const how = "Each MCAP file holds the session's video along with its other streams, so that's all you need. Download the files you want from the folder, then open them in Foxglove or any MCAP reader.";
  const text = [`Hi ${first},`, "", intro, "", `Open the Google Drive folder: ${p.link}`, "", how, "", "— Awign Robotics Data"].join("\n");
  const html = page(
    "Free sample",
    `Your sample is ready, ${first}.`,
    `<p style="${P}">${esc(intro)}</p>
<a href="${esc(p.link)}" style="display:inline-block;background:#0a5bd3;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:14px 24px;border-radius:999px">Open the Google Drive folder</a>
<p style="${NOTE}">${esc(how)} If the button doesn't work, paste this into your browser:<br><a href="${esc(p.link)}" style="color:#0a5bd3;word-break:break-all">${esc(p.link)}</a></p>`,
  );
  return { to: p.to, subject: "Your Awign dataset sample is ready", html, text };
}

/** Head + wrist free sample: no data yet, only that it's on the way. */
export function samplePreparingEmail(p: { to: string; name: string; token: string }): Email {
  const first = firstName(p.name);
  const body = "We've received your request for a free sample of the Awign head + wrist dataset, and we're preparing it now. As soon as it's ready, we'll share it with you by email.";
  const quote = `Your request number is ${p.token}, in case you need to reach us about it.`;
  const text = [`Hi ${first},`, "", body, "", quote, "", "— Awign Robotics Data"].join("\n");
  const html = page(
    `Free sample · ${p.token}`,
    `We're preparing your sample, ${first}.`,
    `<p style="${P}">${esc(body)}</p>
<p style="${P};margin-bottom:0">${esc(quote)}</p>`,
  );
  return { to: p.to, subject: `We're preparing your Awign sample (${p.token})`, html, text };
}

const summaryLine = (p: { hours: number; size: string | null }) =>
  `${p.hours.toLocaleString("en-IN")} h${p.size ? ` · about ${p.size}` : ""}`;

/** Full dataset: the confirmation sent as soon as the request is in. */
export function datasetReceivedEmail(p: { to: string; name: string; token: string; hours: number; size: string | null }): Email {
  const first = firstName(p.name);
  const summary = summaryLine(p);
  const body = "We've received your dataset request and we're preparing your data. It will take some time; when it's ready, we'll email you the details to access it.";
  const quote = `Your request number is ${p.token}, in case you need to reach us about it.`;
  const text = [`Hi ${first},`, "", body, "", summary, quote, "", "— Awign Robotics Data"].join("\n");
  const html = page(
    `Request received · ${p.token}`,
    `We've got your request, ${first}.`,
    `<p style="${P}">${esc(body)}</p>
<p style="${P};margin-bottom:0"><strong style="color:#0b1220">${esc(summary)}</strong><br>${esc(quote)}</p>`,
  );
  return { to: p.to, subject: `We've received your dataset request (${p.token})`, html, text };
}

/** The keys to a bucket: a dataset's own (`summary` says what's in it), or the shared head + wrist sample bucket (null). */
export function bucketAccessEmail(p: {
  to: string;
  name: string;
  token: string;
  summary: { hours: number; size: string | null } | null;
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secret: string;
}): Email {
  const first = firstName(p.name);
  const noun = p.summary ? "dataset" : "sample";
  const summary = p.summary ? summaryLine(p.summary) : null;
  const where = p.summary ? "Your dataset is ready in its own Cloudflare R2 bucket." : "Your free sample is ready in a Cloudflare R2 bucket.";
  const intro = `${where} R2 works with any S3-compatible tool, such as the AWS CLI or rclone.`;
  const rows: [string, string][] = [
    ["Endpoint", p.endpoint],
    ["Bucket", p.bucket],
    ["Region", "auto"],
    ["Access key ID", p.accessKeyId],
    ["Secret access key", p.secret],
  ];
  const command = `aws s3 sync s3://${p.bucket} ./awign-${noun} --endpoint-url ${p.endpoint} --region auto`;
  const private_ = "Keep these keys private: anyone who has them can read this bucket.";
  const text = [
    `Hi ${first},`,
    "",
    intro,
    ...(summary ? [summary] : []),
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    "",
    "With the AWS CLI, set the two keys with `aws configure`, then run:",
    command,
    "",
    private_,
    "",
    "— Awign Robotics Data",
  ].join("\n");
  const html = page(
    `${p.summary ? "Dataset" : "Sample"} ready · ${p.token}`,
    `Your ${noun} is ready, ${first}.`,
    `<p style="${P}">${esc(intro)}</p>
${summary ? `<p style="${P}"><strong style="color:#0b1220">${esc(summary)}</strong></p>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;font-size:14px;line-height:1.5">
${rows
  .map(
    ([k, v]) =>
      `<tr><td style="padding:6px 12px 6px 0;color:#6b7280;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:6px 0;font-family:Menlo,Consolas,monospace;font-size:13px;word-break:break-all">${esc(v)}</td></tr>`,
  )
  .join("\n")}
</table>
<p style="margin:0 0 8px;font-size:15px;line-height:1.5;color:#4b5563">With the AWS CLI, set the two keys with <code>aws configure</code>, then run:</p>
<p style="${CODE}">${esc(command)}</p>
<p style="${NOTE}">${esc(private_)}</p>`,
  );
  return { to: p.to, subject: `Your Awign ${noun} is ready (${p.token})`, html, text };
}
