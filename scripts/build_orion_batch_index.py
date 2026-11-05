"""Build the episode rows for a new Orion submission batch, from its two sheets.

    python scripts/build_orion_batch_index.py \\
        --clips "data/Batch 6 Submission Orion - Submission Dump Tanishaq.csv" \\
        --metadata "data/6th Batch Submission - Submision data.csv" \\
        --out data/ots_episodes_batch6.csv

Batches from 6 on arrive as two sheets instead of one, joined on lead_id:
  --clips     one row per lead: skill_group and the clip lists (a lead can hold
              several clips, stored as JSON lists in the same cell).
  --metadata  one row per lead: environment and task name. A totals row may sit
              above the header.

Writes only rows that aren't in the index yet, with the columns of ots_episodes,
because the Table Editor import fails on a repeated episode_id. Import --out with
Table Editor -> ots_episodes -> Insert -> Import data from CSV.

R2 is only ever listed, with the read-only key from .env: that gives each video's
real size (neither sheet has one) and proves the files exist, so an episode that
couldn't be delivered never reaches a customer. Listings are cached next to --out,
so a re-run after a crash doesn't start over.

What it decides, and why:
  * Difficulty comes from the clip's task_id, not the metadata sheet. On the
    37,615 rows of batches 1-5 the two agree 99.1%; in batch 6 only 68.4%, while
    environment still agrees 99.9%, so that one metadata column is off.
  * A clip folder claimed by two leads is dropped, both times: the two disagree on
    task and duration, and nothing says which one describes the video.
  * Personal and location columns (city, geohash, operator, age, gender) are never
    read into the output; location_name stays empty, the app doesn't use it.
  * The URLs say .../EGO/stereo.mp4 but the R2 key is .../Ego/..., so only the
    episode folder is stored.
"""

import argparse
import csv
import json
import os
import re
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import boto3
from botocore.config import Config

sys.path.insert(0, str(Path(__file__).parent))
from build_episode_index import DOMAINS, OUT_COLS, SKILLS, URL_RE, norm  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
R2_ENDPOINT = "https://fba1fd7178f04a07c2c459f00a47a625.r2.cloudflarestorage.com"
# Rule 0 of the workspace: these are the buckets this project may read.
ALLOWED_BUCKETS = {"orion-awign", "orion-awign-v1"}
COL = "recording_url_segmentation_recording_metadata:recording_url_segmentation_recording_metadata_"
VIDEO = "Ego/stereo.mp4"
MCAP = "OutputsCrf16/session.mcap"
csv.field_size_limit(10_000_000)


def calibration_files() -> set[str]:
    """The customer-safe calibration allowlist, read from its one source of truth."""
    src = (ROOT / "src/lib/episode-layout.ts").read_text(encoding="utf-8")
    block = re.search(r"export const CALIBRATION_FILES = new Set\(\[(.*?)\]\);", src, re.S)
    if not block:
        sys.exit("CALIBRATION_FILES not found in src/lib/episode-layout.ts")
    return set(re.findall(r'"([^"]+)"', block[1]))


def read_rows(path: str) -> list[dict]:
    """A sheet as dicts; the header is the first row that has lead_id."""
    with open(path, encoding="utf-8-sig", newline="") as f:
        raw = list(csv.reader(f))
    at = next((i for i, r in enumerate(raw[:6]) if "lead_id" in (c.strip() for c in r)), None)
    if at is None:
        sys.exit(f"no lead_id column in {path}")
    head = [c.strip() for c in raw[at]]
    return [dict(zip(head, r)) for r in raw[at + 1:]]


def cell_list(value: str) -> list:
    """A clip cell: one plain value, or a JSON-ish list with nil for empty."""
    v = (value or "").strip()
    return json.loads(v.replace("nil", "null")) if v.startswith("[") else [v]


def clean_task(name: str) -> str:
    """The export broke every '–' in some rows into a run of U+FFFD."""
    return re.sub(r"\s*�+\s*", " – ", name).strip()


def difficulty_of(task_id: str) -> str | None:
    found = re.findall(r"_(easy|medium|hard)_", task_id.lower())
    return found[-1] if found else None


def expand_clips(clip_rows: list[dict], meta: dict[str, dict]) -> tuple[list[dict], dict[str, list[str]]]:
    """One record per clip, plus every clip dropped and why."""
    clips: list[dict] = []
    dropped: dict[str, list[str]] = {}

    def drop(reason: str, what: str) -> None:
        dropped.setdefault(reason, []).append(what)

    for row in clip_rows:
        lead = row["lead_id"]
        m = meta.get(lead)
        if m is None:
            drop("lead not in the metadata sheet", lead)
            continue
        parts = [cell_list(row[COL + k]) for k in ("from_time", "to_time", "trimmed_url", "task_id", "is_usable", "status")]
        if len({len(p) for p in parts}) != 1:
            drop("clip lists of different lengths", lead)
            continue
        for start, end, url, task_id, usable, status in zip(*parts):
            path = URL_RE.match(str(url).strip())
            if not path:
                drop("path is not .../EGO/stereo.mp4", lead)
                continue
            prefix = path["prefix"]
            episode = prefix.rstrip("/").rsplit("/", 1)[-1]
            if str(usable).lower() != "true" or str(status).lower() != "success":
                drop("clip not usable", episode)
                continue
            domain = DOMAINS.get(norm(m["environment_l1"]))
            skill = SKILLS.get(norm(row["skill_group"]))
            difficulty = difficulty_of(str(task_id))
            seconds = round(float(end) - float(start))
            if not domain:
                drop("unknown environment", episode)
            elif not skill:
                drop("unknown skill group", episode)
            elif not difficulty:
                drop("no difficulty in task_id", episode)
            elif seconds <= 0:
                drop("missing or zero duration", episode)
            else:
                clips.append({
                    "episode_id": episode,
                    "bucket": path["bucket"],
                    "prefix": prefix,
                    "capture_setup": "ego",
                    "domain": domain,
                    "skill": skill,
                    "difficulty": difficulty,
                    "duration_s": seconds,
                    "stereo_bytes": None,
                    "mcap_bytes": None,
                    "task_name": clean_task(m["task_name"]),
                    "location_name": "",
                    "environment_l2": m["environment_l2"].strip(),
                    "environment_l3": m["environment_l3"].strip(),
                    "_metadata_difficulty": m["task_difficulty"].strip().lower(),
                })
    return clips, dropped


def read_only_client():
    """An R2 client holding the read-only key and nothing else."""
    env = {}
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        if line.startswith(("R2_READ_ACCESS_KEY_ID=", "R2_READ_SECRET_ACCESS_KEY=", "R2_ENDPOINT=")):
            key, _, value = line.partition("=")
            env[key] = value.strip().strip('"')
    if not env.get("R2_READ_ACCESS_KEY_ID") or not env.get("R2_READ_SECRET_ACCESS_KEY"):
        sys.exit("R2_READ_ACCESS_KEY_ID / R2_READ_SECRET_ACCESS_KEY missing from .env")
    return boto3.client(
        "s3",
        endpoint_url=env.get("R2_ENDPOINT") or R2_ENDPOINT,
        aws_access_key_id=env["R2_READ_ACCESS_KEY_ID"],
        aws_secret_access_key=env["R2_READ_SECRET_ACCESS_KEY"],
        region_name="auto",
        config=Config(
            signature_version="s3v4", s3={"addressing_style": "path"}, max_pool_connections=32,
            retries={"max_attempts": 6, "mode": "standard"}, connect_timeout=15, read_timeout=60,
        ),
    )


def list_clip(client, bucket: str, prefix: str, allow: set[str]) -> dict:
    """Sizes of what delivery needs. Numbers only: no file names are kept."""
    found = {"mp4": None, "mcap": None, "calibration": 0}
    for page in client.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []):
            rel = obj["Key"][len(prefix):]
            if rel == VIDEO:
                found["mp4"] = obj["Size"]
            elif rel == MCAP:
                found["mcap"] = obj["Size"]
            elif rel.startswith("Ego/") and rel[4:] in allow:
                found["calibration"] += 1
    return found


def list_all(clips: list[dict], cache_path: Path, workers: int) -> dict:
    """Lists every clip folder once. Exits without output if any listing fails."""
    allow = calibration_files()
    cache = json.loads(cache_path.read_text(encoding="utf-8")) if cache_path.exists() else {}

    def save() -> None:
        tmp = cache_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(cache), encoding="utf-8")
        os.replace(tmp, cache_path)

    todo = [c for c in clips if f"{c['bucket']}|{c['prefix']}" not in cache]
    print(f"listing {len(todo):,} clip folders ({len(clips) - len(todo):,} cached), read-only...", flush=True)
    client = read_only_client()
    failed = 0
    with ThreadPoolExecutor(workers) as pool:
        jobs = {pool.submit(list_clip, client, c["bucket"], c["prefix"], allow): c for c in todo}
        for done, job in enumerate(as_completed(jobs), 1):
            c = jobs[job]
            try:
                cache[f"{c['bucket']}|{c['prefix']}"] = job.result()
            except Exception as e:  # kept going so one bad folder doesn't lose the rest
                failed += 1
                print(f"  failed: {c['episode_id']}: {e}", flush=True)
            if done % 500 == 0:
                save()
                print(f"  {done:,} of {len(todo):,}", flush=True)
    save()
    if failed:
        sys.exit(f"{failed} listings failed; nothing written. Run again: finished ones are cached in {cache_path.name}.")
    return cache


def hours_by(rows: list[dict], key: str) -> str:
    h = Counter()
    for r in rows:
        h[r[key]] += r["duration_s"] / 3600
    return "\n".join(f"  {v:9.1f} h  {k}" for k, v in h.most_common())


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--clips", required=True)
    ap.add_argument("--metadata", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--workers", type=int, default=16)
    args = ap.parse_args()
    out = Path(args.out)

    clip_rows = read_rows(args.clips)
    meta = {r["lead_id"]: r for r in read_rows(args.metadata)}
    clips, dropped = expand_clips(clip_rows, meta)
    print(f"{len(clip_rows):,} leads -> {len(clips):,} clips, {sum(c['duration_s'] for c in clips) / 3600:,.1f} h")

    # Claimed twice in this batch: both go, see the docstring.
    uses = Counter((c["bucket"], c["prefix"]) for c in clips)
    names = Counter(c["episode_id"] for c in clips)
    for c in clips:
        if uses[(c["bucket"], c["prefix"])] > 1 or names[c["episode_id"]] > 1:
            dropped.setdefault("clip folder claimed by two leads", []).append(c["episode_id"])
    clips = [c for c in clips if uses[(c["bucket"], c["prefix"])] == 1 and names[c["episode_id"]] == 1]

    # Already in the index: the imported row stays.
    known_ids, known_folders = set(), set()
    for path in out.parent.glob("ots_episodes*.csv"):
        if path.resolve() == out.resolve():
            continue
        with open(path, encoding="utf-8", newline="") as f:
            for r in csv.DictReader(f):
                known_ids.add(r["episode_id"])
                known_folders.add((r["bucket"], r["prefix"]))
    fresh = []
    for c in clips:
        if c["episode_id"] in known_ids or (c["bucket"], c["prefix"]) in known_folders:
            dropped.setdefault("already in the index", []).append(c["episode_id"])
        else:
            fresh.append(c)
    clips = fresh

    outside = {c["bucket"] for c in clips} - ALLOWED_BUCKETS
    if outside:
        sys.exit(f"sheet points at buckets this project may not read: {sorted(outside)}")

    listing = list_all(clips, out.with_suffix(".r2.json"), args.workers)
    keep = []
    mcap_bytes = mcap_seconds = 0
    no_mcap = 0
    for c in clips:
        found = listing[f"{c['bucket']}|{c['prefix']}"]
        if not found["mp4"]:
            dropped.setdefault("no Ego/stereo.mp4 in the bucket", []).append(c["episode_id"])
        elif not found["calibration"]:
            dropped.setdefault("no calibration in the bucket", []).append(c["episode_id"])
        else:
            c["stereo_bytes"] = found["mp4"]
            c["mcap_bytes"] = found["mcap"]
            keep.append(c)
            if found["mcap"]:
                mcap_bytes += found["mcap"]
                mcap_seconds += c["duration_s"]
            else:
                no_mcap += 1

    with open(out, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=OUT_COLS, extrasaction="ignore")
        w.writeheader()
        w.writerows(keep)

    hours = sum(c["duration_s"] for c in keep) / 3600
    video = sum(c["stereo_bytes"] for c in keep)
    print(f"\nwrote {len(keep):,} new episodes, {hours:,.1f} h, to {out}")
    for reason, items in dropped.items():
        print(f"  dropped {len(items):>5}  {reason}: " + ", ".join(items[:3]) + (" ..." if len(items) > 3 else ""))
    print(f"\nvideo: {video / 1e12:,.2f} TB, {video / 1e9 / hours:.2f} GB/h")
    if mcap_seconds:
        print(f"MCAP:  {mcap_bytes / 1e12:,.2f} TB, {mcap_bytes / 1e9 / (mcap_seconds / 3600):.2f} GB/h; {no_mcap:,} episodes have none")
    differs = sum(c["difficulty"] != c["_metadata_difficulty"] for c in keep)
    print(f"difficulty differs from the metadata sheet on {differs:,} of {len(keep):,} episodes (task_id used)")
    print("\nhours by environment:\n" + hours_by(keep, "domain"))
    print("\nhours by skill:\n" + hours_by(keep, "skill"))
    print("\nhours by difficulty:\n" + hours_by(keep, "difficulty"))


if __name__ == "__main__":
    main()
