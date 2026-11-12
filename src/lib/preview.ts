import "server-only";
import { DOMAINS, DOMAIN_BY_SLUG, type SetupId } from "./catalog";
import { encodeKeyPath, encodeQuery, signedGetHeaders } from "./r2-sign";

// Preview videos, one or more per environment type, played on the site from
// /api/preview/<slug>?clip=<n>. The server fetches each one from R2 and passes the bytes
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

// Each capture setup and environment type has a folder in the preview bucket holding one or more clips:
//   home/home.mp4                 Ego-centric, clip 1 (always first)
//   home/home-2.mp4               clip 2, then any other .mp4 in the folder in name order
//   head-wrist/home/home.mp4      Head + wrist (head stereo on top, both wrists below), same naming
// The server lists the bucket to see what is there, so adding or removing a clip needs no code
// change. The browser asks for /api/preview/<slug>?setup=<setup>&clip=<n> and never learns a file name.

/** Where each setup's folders start in the bucket. Ego-centric was first, so it sits at the top. */
const SETUP_FOLDER: Readonly<Record<SetupId, string>> = { ego: "", head_wrist: "head-wrist/" };
const SETUP_IDS = Object.keys(SETUP_FOLDER) as SetupId[];

/** How long a listing is trusted before the bucket is listed again. */
const LIST_TTL_MS = 5 * 60_000;
/** After a failed listing, how long before trying again (the last good listing, or the fallback, serves meanwhile). */
const LIST_RETRY_MS = 60_000;

type Clips = Record<SetupId, Record<string, string[]>>;
let listed: { at: number; ttl: number; clips: Clips } | null = null;
let listing: Promise<Clips> | null = null;

/**
 * What the site falls back to if a listing fails: Ego-centric clip 1 at its fixed name (what it
 * served before it listed), and no head + wrist clips (there is no fixed set of those to assume).
 */
const fallbackClips = (): Clips => ({ ego: Object.fromEntries(DOMAINS.map((d) => [d.slug, [`${d.slug}/${d.slug}.mp4`]])), head_wrist: {} });

const byName = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/** Group listed keys into each setup's and catalog type's clips, in play order. Keys outside those folders are ignored. */
function groupClips(keys: string[]): Clips {
  const clips = { ego: {}, head_wrist: {} } as Clips;
  for (const setup of SETUP_IDS) {
    for (const { slug } of DOMAINS) {
      const folder = `${SETUP_FOLDER[setup]}${slug}/`;
      const first = `${folder}${slug}.mp4`;
      const mine = keys
        .filter((k) => k.startsWith(folder) && !k.slice(folder.length).includes("/") && /\.mp4$/i.test(k))
        .sort((a, b) => (a === first ? -1 : b === first ? 1 : byName.compare(a, b)));
      if (mine.length) clips[setup][slug] = mine;
    }
  }
  return clips;
}

const xmlText = (s: string) =>
  s.replace(/&(lt|gt|quot|apos|amp|#(\d+)|#x([0-9a-f]+));/gi, (_, name: string, dec?: string, hex?: string) =>
    dec ? String.fromCodePoint(Number(dec)) : hex ? String.fromCodePoint(parseInt(hex, 16)) : ({ lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" } as Record<string, string>)[name.toLowerCase()],
  );

/** Every key in the preview bucket (ListObjectsV2, a read). Throws on any failure; callers fall back. */
async function listKeys(cfg: Config): Promise<string[]> {
  const path = `/${encodeKeyPath(cfg.bucket)}`;
  const keys: string[] = [];
  let token: string | undefined;
  // A page holds 1,000 keys; 20 pages is far more than a preview bucket should ever hold.
  for (let page = 0; page < 20; page++) {
    const query: Record<string, string> = { "list-type": "2", "max-keys": "1000" };
    if (token) query["continuation-token"] = token;
    const res = await fetch(`${cfg.origin}${path}?${encodeQuery(query)}`, {
      headers: signedGetHeaders({ host: cfg.host, path, query, region: "auto", accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.text();
    // Status only: the error body names the bucket.
    if (!res.ok) throw new Error(`list answered ${res.status}`);
    for (const m of body.matchAll(/<Key>([^<]*)<\/Key>/g)) keys.push(xmlText(m[1]));
    token = /<IsTruncated>true<\/IsTruncated>/.test(body) ? body.match(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/)?.[1] : undefined;
    if (!token) return keys;
    token = xmlText(token);
  }
  return keys;
}

/** Each environment type's clips (object keys, play order). Listed at most every few minutes; never throws. */
async function clipKeys(cfg: Config): Promise<Clips> {
  if (listed && Date.now() - listed.at < listed.ttl) return listed.clips;
  // One listing at a time: requests arriving meanwhile share it.
  listing ??= listKeys(cfg)
    .then((keys) => {
      listed = { at: Date.now(), ttl: LIST_TTL_MS, clips: groupClips(keys) };
      return listed.clips;
    })
    .catch((e) => {
      console.error("[preview] listing failed:", e instanceof Error ? e.message : "error", listed ? "(keeping the last listing)" : "(clip 1 only until it works)");
      listed = { at: Date.now(), ttl: LIST_RETRY_MS, clips: listed?.clips ?? fallbackClips() };
      return listed.clips;
    })
    .finally(() => {
      listing = null;
    });
  return listing;
}

/**
 * The object behind one clip, or null. Only catalog slugs and listed clips get this far, so a
 * request can never name a path of its own.
 */
async function objectKey(cfg: Config, setup: SetupId, slug: string, clip: number): Promise<string | null> {
  // Own keys only: "__proto__", "constructor" and the like are not environment types.
  if (!Object.hasOwn(DOMAIN_BY_SLUG, slug)) return null;
  const mine = (await clipKeys(cfg))[setup];
  return (Object.hasOwn(mine, slug) && mine[slug][clip - 1]) || null;
}

export type ClipCounts = Record<SetupId, Record<string, number>>;

/** How many clips each setup's environment types have, for the page to know what to offer. Counts only, never names. */
export async function previewClips(): Promise<ClipCounts> {
  const cfg = config();
  if (!cfg) return { ego: {}, head_wrist: {} };
  const clips = await clipKeys(cfg);
  const count = (setup: SetupId) => Object.fromEntries(Object.entries(clips[setup]).map(([slug, keys]) => [slug, keys.length]));
  return { ego: count("ego"), head_wrist: count("head_wrist") };
}

/** The clip number in ?clip=: 1 when absent; null when it is anything but a small whole number. */
export function parseClip(value: string | null): number | null {
  if (value === null) return 1;
  return /^[1-9]\d{0,2}$/.test(value) ? Number(value) : null;
}

/** The setup in ?setup=: Ego-centric when absent; null when it names no setup. */
export function parseSetup(value: string | null): SetupId | null {
  if (value === null) return "ego";
  return (SETUP_IDS as string[]).includes(value) ? (value as SetupId) : null;
}

// One range, as browsers send for video: "bytes=0-", "bytes=1000-1999", "bytes=-500".
const RANGE_RE = /^bytes=(\d{1,15}-\d{0,15}|-\d{1,15})$/;

// What R2 says that a browser may hear. Nothing else is passed on (no x-amz-*, no server names).
const PASS = ["content-length", "content-range", "accept-ranges", "last-modified", "etag"];

const plain = (status: number, text: string) =>
  new Response(text, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

export async function previewResponse(
  slug: string,
  setup: SetupId | null,
  clip: number | null,
  range: string | null,
  method: "GET" | "HEAD" = "GET",
): Promise<Response> {
  const cfg = config();
  if (!cfg || clip === null || setup === null) return plain(404, "Not found");
  const key = await objectKey(cfg, setup, slug, clip);
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
    "content-disposition": `inline; filename="${setup === "ego" ? "" : "head-wrist-"}${slug}${clip > 1 ? `-${clip}` : ""}.mp4"`,
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
