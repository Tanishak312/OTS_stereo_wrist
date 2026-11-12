import "server-only";
import { createHash, createHmac } from "node:crypto";

// AWS Signature V4 for one S3 GET, which is all R2 needs here. Written out rather
// than pulled in as a package so the code that holds the secret stays this small.
// Checked against AWS's own worked example (scratchpad test, see the PR notes).

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const hmac = (key: Buffer | string, s: string) => createHmac("sha256", key).update(s, "utf8").digest();

/** S3 URI encoding of one value: every byte but A-Z a-z 0-9 - _ . ~ */
const encodeValue = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** S3 path encoding: every byte but A-Z a-z 0-9 - _ . ~ and the slashes between segments. */
export function encodeKeyPath(path: string): string {
  return path.split("/").map(encodeValue).join("/");
}

/** The query string as S3 signs it (and as the request must send it): encoded, sorted by name. */
export function encodeQuery(query: Record<string, string>): string {
  return Object.keys(query)
    .sort()
    .map((k) => `${encodeValue(k)}=${encodeValue(query[k])}`)
    .join("&");
}

const EMPTY_SHA256 = sha256("");

/**
 * Headers that authorise a GET of `path` (already encoded, starting with "/") on
 * `host`. The secret is used here and nowhere else; only the signature leaves.
 */
export function signedGetHeaders(opts: {
  host: string;
  path: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  range?: string | null;
  /** Query parameters, sent as encodeQuery(query). */
  query?: Record<string, string>;
  now?: Date;
}): Record<string, string> {
  const amzDate = (opts.now ?? new Date()).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = { host: opts.host };
  if (opts.range) headers.range = opts.range;
  headers["x-amz-content-sha256"] = EMPTY_SHA256;
  headers["x-amz-date"] = amzDate;

  const names = Object.keys(headers).sort();
  const canonical = ["GET", opts.path, opts.query ? encodeQuery(opts.query) : "", ...names.map((n) => `${n}:${headers[n].trim()}`), "", names.join(";"), EMPTY_SHA256].join("\n");
  const scope = `${day}/${opts.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${opts.secretAccessKey}`, day), opts.region), "s3"), "aws4_request");
  const signature = createHmac("sha256", key).update(toSign, "utf8").digest("hex");

  const { host: _host, ...rest } = headers;
  return {
    ...rest,
    authorization: `AWS4-HMAC-SHA256 Credential=${opts.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`,
  };
}
