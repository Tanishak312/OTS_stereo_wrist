#!/usr/bin/env python3
"""Copies the Ego-centric sample from R2 to the Google Drive folder, listed in files.csv.

    python upload.py --check     tests everything and shows what's left; changes nothing
    python upload.py --run       uploads what's left, then verifies

Safe to stop and run again at any time, on any machine: it asks Drive what's already
there and carries on from that. See README.md. Needs Python 3.8+ and rclone, nothing else.

R2 is only ever read. Nothing on Drive is deleted. Don't run it on two machines at once:
Drive allows two files with the same name, so that would create duplicates.
"""
import argparse
import csv
import json
import os
import shutil
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
ENDPOINT = "https://fba1fd7178f04a07c2c459f00a47a625.r2.cloudflarestorage.com"
ALLOWED_BUCKETS = {"orion-awign", "orion-awign-v1"}
PASSES = 3  # how many times to go back for files that failed

ap = argparse.ArgumentParser(description="Upload the Ego-centric sample to Google Drive. Safe to re-run.")
mode = ap.add_mutually_exclusive_group(required=True)
mode.add_argument("--check", action="store_true", help="test the setup and show what's left; changes nothing")
mode.add_argument("--run", action="store_true", help="upload what's left, then verify")
ap.add_argument("--dest", default="ots-drive:", help="rclone destination (default: the ots-drive remote)")
ap.add_argument("--workers", type=int, default=3, help="files at a time (default 3)")
ap.add_argument("--limit", type=int, default=0, help="only the N smallest files, for a test")
ap.add_argument("--rclone", default="", help="path to rclone, if it isn't on PATH")
args = ap.parse_args()


def die(msg):
    print(f"\nSTOPPED: {msg}", file=sys.stderr)
    sys.exit(1)


rclone = args.rclone or shutil.which("rclone")
if not rclone:
    die("rclone not found. Install it (see README.md), or pass --rclone <path>.")

# The read key only. A write key in .env is ignored: nothing here should be able to change R2.
keys = {k: os.environ[k] for k in ("R2_READ_ACCESS_KEY_ID", "R2_READ_SECRET_ACCESS_KEY") if os.environ.get(k)}
env_file = HERE / ".env"
if env_file.exists():
    for line in env_file.read_text(encoding="utf-8").splitlines():
        if line.startswith("R2_READ_") and "=" in line:
            k, v = line.strip().split("=", 1)
            keys.setdefault(k, v.strip().strip('"'))
if not keys.get("R2_READ_ACCESS_KEY_ID") or not keys.get("R2_READ_SECRET_ACCESS_KEY"):
    die("R2 read key missing. Copy .env.example to .env and fill in both values.")

env = dict(os.environ)
env.update(
    RCLONE_CONFIG_R2_TYPE="s3",
    RCLONE_CONFIG_R2_PROVIDER="Cloudflare",
    RCLONE_CONFIG_R2_ENDPOINT=ENDPOINT,
    RCLONE_CONFIG_R2_ACCESS_KEY_ID=keys["R2_READ_ACCESS_KEY_ID"],
    RCLONE_CONFIG_R2_SECRET_ACCESS_KEY=keys["R2_READ_SECRET_ACCESS_KEY"],
    RCLONE_CONFIG_R2_NO_CHECK_BUCKET="true",
)

rows = list(csv.DictReader(open(HERE / "files.csv", encoding="utf-8-sig")))
bad = {r["r2_bucket"] for r in rows} - ALLOWED_BUCKETS
if bad:
    die(f"files.csv names a bucket outside the sample: {sorted(bad)}")
if args.limit:
    rows = sorted(rows, key=lambda r: int(r["size_bytes"]))[: args.limit]
DEST = args.dest if args.dest.endswith((":", "/")) else args.dest + "/"
TOTAL = sum(int(r["size_bytes"]) for r in rows)
lock = threading.Lock()


def log(msg):
    line = f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}"
    print(line, flush=True)
    with lock, open(HERE / "upload.log", "a", encoding="utf-8") as f:
        f.write(line + "\n")


def rc(*a):
    return subprocess.run([rclone, *a], env=env, capture_output=True, text=True, encoding="utf-8", errors="replace")


def listing(*flags):
    """What's on the destination. A failed listing stops the run: it must never read as 'nothing there yet'."""
    p = rc("lsjson", "-R", "--no-modtime", "--no-mimetype", *flags, DEST)
    if p.returncode:
        die(f"couldn't list {DEST}. Is the Google login done? (see README.md)\n{p.stderr[-400:].strip()}")
    return json.loads(p.stdout or "[]")


def state():
    """(left to upload, files with a size that doesn't match, duplicates, files not in the list)."""
    items = listing("--files-only")
    have, dupes = {}, []
    for x in items:
        if x["Path"] in have:
            dupes.append(x["Path"])
        have[x["Path"]] = x["Size"]
    wanted = {r["drive_path"]: int(r["size_bytes"]) for r in rows}
    left = [r for r in rows if have.get(r["drive_path"]) != int(r["size_bytes"])]
    wrong = [p for p, s in wanted.items() if p in have and have[p] != s]
    extra = [p for p in have if p not in wanted]
    return left, wrong, dupes, extra


if args.check:
    print(f"rclone: {subprocess.run([rclone, 'version'], capture_output=True, text=True).stdout.splitlines()[0]}")
    for r in rows[:2] + rows[-2:]:
        p = rc("lsjson", f"r2:{r['r2_bucket']}/{r['r2_key']}")
        found = json.loads(p.stdout)[0]["Size"] if p.returncode == 0 and p.stdout.strip() not in ("", "[]") else None
        if found != int(r["size_bytes"]):
            die(f"R2 read failed for {r['r2_bucket']}. Check the read key.\n{p.stderr[-300:].strip()}")
    print("R2 read key: works")
    left, wrong, dupes, extra = state()
    left_gb = sum(int(r["size_bytes"]) for r in left) / 1e9
    print(f"Drive: works | done {len(rows) - len(left)} of {len(rows)} files | left {len(left)} files, {left_gb:.1f} GB of {TOTAL / 1e9:.1f} GB")
    print(f"wrong size {len(wrong)} | duplicates {len(dupes)} | files not in the list {len(extra)}")
    print("Nothing was changed. If this all looks right: python upload.py --run")
    sys.exit()

t0 = time.time()
log(f"START {len(rows)} files, {TOTAL / 1e9:.1f} GB, to {DEST}")

# Folders first, one at a time: uploading in parallel into a missing folder can create two of it.
existing = {x["Path"] for x in listing("--dirs-only")}
need = sorted({r["drive_path"].rsplit("/", 1)[0] for r in rows} - existing)
for d in need:
    p = rc("mkdir", DEST + d)
    if p.returncode:
        die(f"couldn't create folder {d}: {p.stderr[-300:].strip()}")
if need:
    log(f"created {len(need)} folders")


def upload(r, counter, count_all):
    p = rc(
        "copyto", f"r2:{r['r2_bucket']}/{r['r2_key']}", DEST + r["drive_path"],
        "--drive-chunk-size", "64M", "--retries", "5", "--low-level-retries", "20",
        "-v", "--stats", "30s", "--stats-one-line", "--log-file", str(HERE / "rclone.log"),
    )
    with lock:
        counter[0] += 1
        counter[1] += int(r["size_bytes"])
        n, gb = counter
    hours = (time.time() - t0) / 3600
    if p.returncode:
        log(f"FAILED {r['drive_path']}: see rclone.log")
    else:
        log(f"{n}/{count_all} this run | {gb / 1e9:.1f} GB in {hours:.2f} h")
    return p.returncode


left = []
for attempt in range(1, PASSES + 1):
    left, wrong, dupes, extra = state()
    if not left:
        break
    size = sum(int(r["size_bytes"]) for r in left) / 1e9
    log(f"pass {attempt}: {len(rows) - len(left)} already there, {len(left)} left, {size:.1f} GB")
    counter = [0, 0]
    with ThreadPoolExecutor(args.workers) as ex:
        list(ex.map(lambda r: upload(r, counter, len(left)), left))

left, wrong, dupes, extra = state()
gb = sum(int(r["size_bytes"]) for r in rows if r not in left) / 1e9
log(f"DONE in {(time.time() - t0) / 3600:.2f} h | on Drive {len(rows) - len(left)} of {len(rows)} files, {gb:.1f} GB | left {len(left)} | wrong size {len(wrong)} | duplicates {len(dupes)} | files not in the list {len(extra)}")
if left or dupes:
    for r in left[:10]:
        log(f"  still left: {r['drive_path']}")
    for p in dupes[:10]:
        log(f"  duplicate: {p}")
    print("\nNot finished cleanly. Fix the cause (see rclone.log), then run it again.")
    sys.exit(1)
print("\nAll files are on Drive and every size matches.")
