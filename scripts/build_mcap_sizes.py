"""List the real size of every Ego-centric episode's MCAP.

    python scripts/build_mcap_sizes.py

Reads the ego rows of data/ots_episodes*.csv and writes
data/ots_episode_mcap_sizes.csv (episode_id, mcap_bytes), for
supabase/012_apply_mcap_sizes.sql. An episode with no MCAP in R2 is left out of
that file and listed in data/ots_episodes_no_mcap.csv.

R2 is only read (HEAD), with the read-only key from .env. Answers are cached, so a
re-run after a crash carries on, and the batch builder's listings are reused.
Nothing is written if any call fails.
"""

import argparse
import csv
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from botocore.exceptions import ClientError

sys.path.insert(0, str(Path(__file__).parent))
from build_orion_batch_index import ALLOWED_BUCKETS, MCAP, ROOT, read_only_client  # noqa: E402

DATA = ROOT / "data"
CACHE = DATA / "ots_episode_mcap_sizes.r2.json"


def head(client, bucket: str, key: str) -> int | None:
    try:
        return client.head_object(Bucket=bucket, Key=key)["ContentLength"]
    except ClientError as e:
        if e.response["ResponseMetadata"]["HTTPStatusCode"] == 404:
            return None
        raise


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--workers", type=int, default=32)
    args = ap.parse_args()

    rows = {}
    for path in sorted(DATA.glob("ots_episodes*.csv")):
        if path.name == "ots_episodes_no_mcap.csv":
            continue
        with open(path, encoding="utf-8", newline="") as f:
            for r in csv.DictReader(f):
                if r["capture_setup"] == "ego":
                    rows[r["episode_id"]] = r
    outside = {r["bucket"] for r in rows.values()} - ALLOWED_BUCKETS
    if outside:
        sys.exit(f"index points at buckets this project may not read: {sorted(outside)}")

    cache = json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {}
    for listing in DATA.glob("ots_episodes_batch*.r2.json"):
        for where, found in json.loads(listing.read_text(encoding="utf-8")).items():
            cache.setdefault(where, found["mcap"])

    def save() -> None:
        tmp = CACHE.with_suffix(".tmp")
        tmp.write_text(json.dumps(cache), encoding="utf-8")
        os.replace(tmp, CACHE)

    where = lambda r: f"{r['bucket']}|{r['prefix']}"  # noqa: E731
    todo = [r for r in rows.values() if where(r) not in cache]
    print(f"{len(rows):,} ego episodes; checking {len(todo):,} in R2, read-only...", flush=True)
    client = read_only_client()
    failed = 0
    with ThreadPoolExecutor(args.workers) as pool:
        jobs = {pool.submit(head, client, r["bucket"], r["prefix"] + MCAP): r for r in todo}
        for done, job in enumerate(as_completed(jobs), 1):
            r = jobs[job]
            try:
                cache[where(r)] = job.result()
            except Exception as e:  # kept going so one bad call doesn't lose the rest
                failed += 1
                print(f"  failed: {r['episode_id']}: {e}", flush=True)
            if done % 2000 == 0:
                save()
                print(f"  {done:,} of {len(todo):,}", flush=True)
    save()
    if failed:
        sys.exit(f"{failed} calls failed; nothing written. Run again: finished ones are cached in {CACHE.name}.")

    have = [(r, cache[where(r)]) for r in rows.values() if cache[where(r)]]
    missing = [r for r in rows.values() if not cache[where(r)]]
    with open(DATA / "ots_episode_mcap_sizes.csv", "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["episode_id", "mcap_bytes"])
        w.writerows((r["episode_id"], size) for r, size in have)
    with open(DATA / "ots_episodes_no_mcap.csv", "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["episode_id", "bucket", "prefix", "duration_s", "domain", "skill"])
        w.writerows((r["episode_id"], r["bucket"], r["prefix"], r["duration_s"], r["domain"], r["skill"]) for r in missing)

    total = sum(size for _, size in have)
    hours = sum(int(r["duration_s"]) for r, _ in have) / 3600
    print(f"\nwith MCAP: {len(have):,} episodes, {hours:,.1f} h, {total / 1e12:,.2f} TB, {total / 1e9 / hours:.2f} GB/h")
    print(f"no MCAP:   {len(missing):,} episodes, {sum(int(r['duration_s']) for r in missing) / 3600:,.1f} h")
    print(f"biggest:   {max(size for _, size in have) / 1e9:.1f} GB")
    for b in sorted({r["bucket"] for r in rows.values()}):
        n = sum(r["bucket"] == b for r in missing)
        print(f"  {b}: {sum(r['bucket'] == b for r in rows.values()):,} episodes, {n:,} without MCAP")


if __name__ == "__main__":
    main()
