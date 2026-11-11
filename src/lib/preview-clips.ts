import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DOMAIN_BY_SLUG, lookupTable } from "./catalog";

/**
 * TEMPORARY, for testing the preview design only: one Ego-centric stereo.mp4 per
 * environment type, read straight from the main bucket (orion-awign-v1) until the
 * preview bucket is filled. Delete this file once it is; previews there are named
 * <slug>.mp4 and need no map.
 *
 * The 24 object keys live in data/preview-clips.json ({ "<slug>": "<key>" }), which is
 * gitignored: they name lead folders, and this repository is public. Without that file
 * (any deploy) there are no clips, so the main bucket is never served from a deploy.
 */
export const MAIN_BUCKET = "orion-awign-v1";

function load(): Readonly<Record<string, string>> {
  try {
    const raw: unknown = JSON.parse(readFileSync(path.join(process.cwd(), "data", "preview-clips.json"), "utf8"));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return lookupTable([]);
    // Only catalog slugs, and only plain keys under the episode folders.
    const ok = Object.entries(raw).filter(
      (e): e is [string, string] => Object.hasOwn(DOMAIN_BY_SLUG, e[0]) && typeof e[1] === "string" && /^[A-Za-z0-9_./-]+\/Ego\/stereo\.mp4$/.test(e[1]) && !e[1].includes(".."),
    );
    return lookupTable(ok);
  } catch {
    return lookupTable([]);
  }
}

export const TEMP_MAIN_BUCKET_CLIPS = load();
