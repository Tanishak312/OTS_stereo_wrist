"use client";

import { useActionState, useState } from "react";
import { changeStatus, resendCustomerEmail, sendBucketAccess, type ActionState } from "@/app/admin/actions";
import type { RequestStatus } from "@/lib/status";

const BUTTON_SECONDARY = "h-10 w-full rounded-lg border border-line bg-white text-sm font-medium hover:bg-surface disabled:opacity-60";
const FIELD = "mt-1.5 w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20";

function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm break-words text-danger">
      {message}
    </p>
  );
}

/** The email every request gets by itself: did it go out, and a way to send it again. */
export function CustomerEmail({
  token,
  what,
  sentAt,
  error,
}: {
  token: string;
  /** "Google Drive link", "Preparing notice" or "Confirmation". */
  what: string;
  /** Already formatted: this file runs in the browser. */
  sentAt: string | null;
  error: string | null;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(resendCustomerEmail, { error: null });
  return (
    <form action={action} className="mt-2 space-y-2 text-sm">
      <input type="hidden" name="token" value={token} />
      {error ? (
        <p className="font-medium text-danger">{what} email failed</p>
      ) : sentAt ? (
        <p>
          <span className="font-medium text-success">{what} emailed</span>
          <span className="block text-xs text-muted">{sentAt}</span>
        </p>
      ) : (
        <p className="text-muted">{what} email not sent yet.</p>
      )}
      {/* The stored reason, unless this attempt has a newer one below. */}
      {!state.error && error && <ErrorNote message={error} />}
      <ErrorNote message={state.error} />
      <button type="submit" disabled={pending} className={BUTTON_SECONDARY}>
        {pending ? "Sending…" : sentAt || error ? "Send again" : "Send now"}
      </button>
    </form>
  );
}

export function ReviewPanel({
  token,
  status,
  kind,
  bucketSample,
  email,
  access,
}: {
  token: string;
  status: RequestStatus;
  kind: "dataset" | "sample";
  /** A head + wrist sample: delivered like a dataset, by emailing a bucket's keys. */
  bucketSample: boolean;
  email: string;
  /** What was sent, once it has been. Already formatted. */
  access: { bucket: string | null; keyId: string | null; sentAt: string | null } | null;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(changeStatus, { error: null });
  const [note, setNote] = useState("");
  const open = status === "submitted" || status === "in_review";

  if (bucketSample) {
    if (access) return <AccessSent token={token} email={email} access={access} />;
    return (
      <div className="text-sm">
        <ol className="list-decimal space-y-2 pl-4">
          <li>
            Use the shared head + wrist sample bucket in R2.{" "}
            <span className="font-medium">Never copy a whole episode folder into it:</span> it holds operator names, phone numbers and locations.
          </li>
          <li>Use an R2 API token that is Object Read only, for this bucket only.</li>
          <li>Paste its S3 credentials here.</li>
        </ol>
        <div className="mt-4">
          <AccessForm token={token} email={email} initialBucket="" />
        </div>
      </div>
    );
  }

  // Free samples skip approval: they go out on their own.
  if (kind === "sample") {
    if (status === "sample_sent") return null;
    return (
      <form action={action} className="space-y-3 text-sm">
        <input type="hidden" name="token" value={token} />
        <ErrorNote message={state.error} />
        <button type="submit" name="status" value="sample_sent" disabled={pending} className={BUTTON_SECONDARY}>
          {pending ? "Saving…" : "I sent it by hand, mark as sent"}
        </button>
      </form>
    );
  }

  if (status === "approved") return <AccessSent token={token} email={email} access={access} />;

  return (
    <div className="space-y-5">
      {open && <AccessSteps token={token} email={email} />}

      <form action={action} className={`space-y-3 ${open ? "border-t border-line pt-4" : ""}`}>
        <input type="hidden" name="token" value={token} />
        {open && (
          <div>
            <label htmlFor="note" className="block text-sm font-medium">
              Note <span className="font-normal text-muted">(required to reject)</span>
            </label>
            <textarea
              id="note"
              name="note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={1000}
              placeholder="Visible to admins only"
              className={FIELD}
            />
          </div>
        )}
        <ErrorNote message={state.error} />
        {open ? (
          <>
            {status === "submitted" && (
              <button type="submit" name="status" value="in_review" disabled={pending} className={BUTTON_SECONDARY}>
                Mark as in review
              </button>
            )}
            <button
              type="submit"
              name="status"
              value="rejected"
              disabled={pending || !note.trim()}
              className="h-10 w-full rounded-lg border border-danger/40 bg-white text-sm font-medium text-danger hover:bg-danger-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Reject {token}
            </button>
            {!note.trim() && <p className="text-xs text-muted">Add a note above to reject. The customer isn&rsquo;t emailed.</p>}
          </>
        ) : status === "rejected" ? (
          <button type="submit" name="status" value="in_review" disabled={pending} className={BUTTON_SECONDARY}>
            Reopen for review
          </button>
        ) : null}
      </form>
    </div>
  );
}

/** What was sent, and a way to send a new key. */
function AccessSent({
  token,
  email,
  access,
}: {
  token: string;
  email: string;
  access: { bucket: string | null; keyId: string | null; sentAt: string | null } | null;
}) {
  return (
    <div className="text-sm">
      <p className="font-medium text-success">Bucket access emailed</p>
      <dl className="mt-2 space-y-1.5">
        {(
          [
            ["When", access?.sentAt],
            ["Bucket", access?.bucket],
            ["Access key ID", access?.keyId],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4">
            <dt className="shrink-0 text-muted">{k}</dt>
            <dd className="text-right break-all">{v ?? "—"}</dd>
          </div>
        ))}
      </dl>
      <details className="mt-4 border-t border-line pt-3">
        <summary className="cursor-pointer font-medium text-brand">Send new access</summary>
        <div className="mt-3">
          <AccessForm token={token} email={email} initialBucket={access?.bucket ?? ""} />
        </div>
      </details>
    </div>
  );
}

/** The manual steps, in the order they're done, ending in the form. */
function AccessSteps({ token, email }: { token: string; email: string }) {
  return (
    <div className="text-sm">
      <ol className="list-decimal space-y-2 pl-4">
        <li>
          <a href={`/admin/requests/${encodeURIComponent(token)}/files`} className="font-medium text-brand hover:underline">
            Download the file list (.csv)
          </a>
        </li>
        <li>
          Create a bucket in R2 and copy those files into it.{" "}
          <span className="font-medium">Never copy a whole episode folder:</span> it holds operator names, phone numbers and locations.
        </li>
        <li>Create an R2 API token: Object Read only, for this bucket only.</li>
        <li>Paste its S3 credentials here.</li>
      </ol>
      <div className="mt-4">
        <AccessForm token={token} email={email} initialBucket="" />
      </div>
    </div>
  );
}

function AccessForm({ token, email, initialBucket }: { token: string; email: string; initialBucket: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(sendBucketAccess, { error: null });
  // Held in state so a failed send doesn't wipe what was pasted.
  const [bucket, setBucket] = useState(initialBucket);
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secret, setSecret] = useState("");
  const ready = bucket.trim() && accessKeyId.trim() && secret.trim();

  return (
    <form action={action} autoComplete="off" className="space-y-3 text-sm">
      <input type="hidden" name="token" value={token} />
      <div>
        <label htmlFor="bucket" className="block font-medium">
          Bucket name
        </label>
        <input id="bucket" name="bucket" value={bucket} onChange={(e) => setBucket(e.target.value)} autoComplete="off" spellCheck={false} className={FIELD} />
      </div>
      <div>
        <label htmlFor="accessKeyId" className="block font-medium">
          Access key ID
        </label>
        <input
          id="accessKeyId"
          name="accessKeyId"
          value={accessKeyId}
          onChange={(e) => setAccessKeyId(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          data-1p-ignore="true"
          data-lpignore="true"
          className={FIELD}
        />
      </div>
      <div>
        <label htmlFor="secret" className="block font-medium">
          Secret access key
        </label>
        <input
          id="secret"
          name="secret"
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          autoComplete="new-password"
          data-1p-ignore="true"
          data-lpignore="true"
          className={FIELD}
        />
      </div>
      <ErrorNote message={state.error} />
      <button
        type="submit"
        disabled={pending || !ready}
        className="min-h-11 w-full rounded-lg bg-brand px-3 py-2 text-sm font-semibold [overflow-wrap:anywhere] text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Sending…" : `Email access to ${email}`}
      </button>
      <p className="text-xs text-muted">Marks the request as done. The secret key goes in the email and isn&rsquo;t saved here.</p>
    </form>
  );
}
