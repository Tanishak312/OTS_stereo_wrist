import "server-only";
import { DOMAINS, DOMAIN_BY_SLUG } from "./catalog";
import { MAIN_BUCKET, TEMP_MAIN_BUCKET_CLIPS } from "./preview-clips";
import { encodeKeyPath, signedGetHeaders } from "./r2-sign";

// Preview videos, one per environment type, played on the site from
// /api/preview/<slug>. The server fetches each one from R2 and passes the bytes
// on, so the browser never sees an R2 address, bucket, key, token or file path:
// only that URL. Off (404) unless all four PREVIEW_R2_* values are set.
//
// The token behind PREVIEW_R2_* must be its own R2 API token, Object Read only,
// scoped to the one bucket it serves. None of these may ever be NEXT_PUBLIC_:
// Next.js copies NEXT_PUBLIC_ values into the browser bundle.

type Config = { origin: string; host: string; bucket: string; accessKeyId: string; secretAccessKey: string };

function config(): Config | null {
  const endpoint = process.env.PREVIEW_R2_ENDPOINT?.trim();
  const bucket = process.env.PREVIEW_R2_BUCKET?.trim();
  const accessKeyId = process.env.PREVIEW_R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.PREVIEW_R2_SECRET_ACCESS_KEY?.trim();
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return misconfigured("PREVIEW_R2_ENDPOINT is not a URL");
  }
  // Signed requests go to R2's S3 address and nowhere else (not the dashboard, not a
  // public r2.dev link). Plain http only for a stand-in on this machine during tests.
  const local = url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  if (!local && !(url.protocol === "https:" && R2_HOST.test(url.host))) {
    return misconfigured("PREVIEW_R2_ENDPOINT must be https://<account-id>.r2.cloudflarestorage.com (the S3 API address on the bucket's settings page)");
  }
  if (url.pathname !== "/" && url.pathname !== "") return misconfigured("PREVIEW_R2_ENDPOINT takes no path; the bucket goes in PREVIEW_R2_BUCKET");
  return { origin: url.origin, host: url.host, bucket, accessKeyId, secretAccessKey };
}

const R2_HOST = /^[0-9a-f]{32}(\.(eu|fedramp))?\.r2\.cloudflarestorage\.com$/;

let warned = false;
/** Previews stay off, and the server log says why (once). Never echoes the values. */
function misconfigured(why: string): null {
  if (!warned) console.error(`[preview] off: ${why}`);
  warned = true;
  return null;
}

/**
 * The object behind one environment type's preview, or null. Only slugs in the
 * catalog get this far, so a request can never name a path of its own.
 * TEMPORARY: while previews come from the main bucket, only the fixed test clips
 * are served from it. In the preview bucket each one is <slug>.mp4.
 */
function objectKey(bucket: string, slug: string): string | null {
  // Own keys only: "__proto__", "constructor" and the like are not environment types.
  if (!Object.hasOwn(DOMAIN_BY_SLUG, slug)) return null;
  if (bucket === MAIN_BUCKET) {
    const key = Object.hasOwn(TEMP_MAIN_BUCKET_CLIPS, slug) ? TEMP_MAIN_BUCKET_CLIPS[slug] : null;
    return typeof key === "string" ? key : null;
  }
  return `${slug}.mp4`;
}

/** The environment types that have a preview, for the page to know which to offer. Names only. */
export function previewSlugs(): string[] {
  const cfg = config();
  if (!cfg) return [];
  return DOMAINS.map((d) => d.slug).filter((slug) => objectKey(cfg.bucket, slug) !== null);
}

// One range, as browsers send for video: "bytes=0-", "bytes=1000-1999", "bytes=-500".
const RANGE_RE = /^bytes=(\d{1,15}-\d{0,15}|-\d{1,15})$/;

// What R2 says that a browser may hear. Nothing else is passed on (no x-amz-*, no server names).
const PASS = ["content-length", "content-range", "accept-ranges", "last-modified", "etag"];

const plain = (status: number, text: string) =>
  new Response(text, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

export async function previewResponse(slug: string, range: string | null, method: "GET" | "HEAD" = "GET"): Promise<Response> {
  const cfg = config();
  if (!cfg) return plain(404, "Not found");
  const key = objectKey(cfg.bucket, slug);
  if (!key) return plain(404, "Not found");

  const path = `/${encodeKeyPath(cfg.bucket)}/${encodeKeyPath(key)}`;
  const useRange = range && RANGE_RE.test(range.trim()) ? range.trim() : null;
  let upstream: Response;
  try {
    upstream = await fetch(cfg.origin + path, {
      method: "GET",
      headers: signedGetHeaders({ host: cfg.host, path, region: "auto", accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, range: useRange }),
      cache: "no-store",
      // Gives up if R2 hasn't started answering; once bytes flow, the video plays on.
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    console.error("[preview] fetch failed", slug, e instanceof Error ? e.name : "error");
    return plain(502, "Preview unavailable");
  }

  if (upstream.status === 416) {
    await upstream.body?.cancel();
    const total = upstream.headers.get("content-range");
    return new Response(null, { status: 416, headers: total ? { "content-range": total } : {} });
  }
  if (upstream.status !== 200 && upstream.status !== 206) {
    // Status only: R2's error body names the bucket and key.
    console.error("[preview] r2 answered", upstream.status, "for", slug);
    await upstream.body?.cancel();
    return plain(upstream.status === 404 ? 404 : 502, upstream.status === 404 ? "Not found" : "Preview unavailable");
  }

  const headers = new Headers({
    "content-type": "video/mp4",
    "content-disposition": `inline; filename="${slug}.mp4"`,
    "x-content-type-options": "nosniff",
    "cache-control": "private, max-age=600",
  });
  for (const h of PASS) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  if (method === "HEAD") {
    await upstream.body?.cancel();
    return new Response(null, { status: upstream.status, headers });
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}
