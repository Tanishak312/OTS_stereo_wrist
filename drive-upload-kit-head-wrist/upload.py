#!/usr/bin/env python3
"""Copies the head + wrist sample from R2 to the Google Drive folder, as listed in files.csv.

    python upload.py --check     tests everything and shows what's left; changes nothing
    python upload.py --run       uploads what's left, then verifies

Safe to stop and run again at any time, on any machine: it asks Drive what's already
there and carries on from that. Drive takes about 750 GB a day per account, so a run
stops by itself at that limit: run it again the next day. See README.md.
Needs Python 3.8+ and rclone, nothing else.

R2 is only ever read. Nothing on Drive is deleted. Don't run it on two machines at once:
Drive allows two files with the same name, so that would create duplicates.
"""
import argparse
import collections
import csv
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
ENDPOINT = "https://fba1fd7178f04a07c2c459f00a47a625.r2.cloudflarestorage.com"
ALLOWED_BUCKETS = {"awign-axis"}
PASSES = 3  # how many times to go back for files that failed
FATAL = 7  # rclone's exit code for an error that retrying won't fix, such as Drive's daily limit

ap = argparse.ArgumentParser(description="Upload the head + wrist sample to Google Drive. Safe to re-run.")
mode = ap.add_mutually_exclusive_group(required=True)
mode.add_argument("--check", action="store_true", help="test the setup and show what's left; changes nothing")
mode.add_argument("--run", action="store_true", help="upload what's left, then verify")
ap.add_argument("--dest", default="ots-drive-hw:", help="rclone destination (default: the ots-drive-hw remote)")
ap.add_argument("--workers", type=int, default=2, help="episodes at a time (default 2)")
ap.add_argument("--limit", type=int, default=0, help="only the N smallest episodes, for a test")
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
    sizes = collections.Counter()
    for r in rows:
        sizes[r["episode_id"]] += int(r["size_bytes"])
    keep = {e for e, _ in sorted(sizes.items(), key=lambda kv: kv[1])[: args.limit]}
    rows = [r for r in rows if r["episode_id"] in keep]
DEST = args.dest if args.dest.endswith((":", "/")) else args.dest + "/"
TOTAL = sum(int(r["size_bytes"]) for r in rows)
EPISODES = len({r["episode_id"] for r in rows})
lock = threading.Lock()
daily_limit = threading.Event()


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
    """(files left to upload, duplicates, files not in the list)."""
    have, dupes = {}, []
    for x in listing("--files-only"):
        if x["Path"] in have:
            dupes.append(x["Path"])
        have[x["Path"]] = x["Size"]
    wanted = {r["drive_path"] for r in rows}
    left = [r for r in rows if have.get(r["drive_path"]) != int(r["size_bytes"])]
    return left, dupes, [p for p in have if p not in wanted]


if args.check:
    print(f"rclone: {subprocess.run([rclone, 'version'], capture_output=True, text=True).stdout.splitlines()[0]}")
    probes = [r for r in rows if r["file"].endswith(".mp4")]
    for r in probes[:2] + probes[-2:]:
        p = rc("lsjson", f"r2:{r['r2_bucket']}/{r['r2_prefix']}{r['file']}")
        found = json.loads(p.stdout)[0]["Size"] if p.returncode == 0 and p.stdout.strip() not in ("", "[]") else None
        if found != int(r["size_bytes"]):
            die(f"R2 read failed for {r['r2_bucket']}. Check the read key.\n{p.stderr[-300:].strip()}")
    print("R2 read key: works")
    left, dupes, extra = state()
    left_gb = sum(int(r["size_bytes"]) for r in left) / 1e9
    print(f"Drive: works | {EPISODES} episodes | done {len(rows) - len(left)} of {len(rows)} files | left {len(left)} files, {left_gb:.1f} GB of {TOTAL / 1e9:.1f} GB")
    print(f"duplicates {len(dupes)} | files not in the list {len(extra)}")
    print("Nothing was changed. If this all looks right: python upload.py --run")
    sys.exit()

t0 = time.time()
log(f"START {EPISODES} episodes, {len(rows)} files, {TOTAL / 1e9:.1f} GB, to {DEST}")

# The skill folders first, one at a time: uploading in parallel into a missing folder can create two of it.
existing = {x["Path"] for x in listing("--dirs-only")}
need = sorted({r["drive_path"].rsplit("/", 3)[0] for r in rows} - existing)
for d in need:
    p = rc("mkdir", DEST + d)
    if p.returncode:
        die(f"couldn't create folder {d}: {p.stderr[-300:].strip()}")
if need:
    log(f"created {len(need)} folders")


def upload(group, counter, count_all):
    """One episode's missing files, as one rclone job, which keeps its folders inside one process."""
    if daily_limit.is_set():
        return 0
    first = group[0]
    root = first["drive_path"][: -len(first["file"])]
    size = sum(int(r["size_bytes"]) for r in group)
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False, encoding="utf-8") as f:
        f.write("\n".join(r["file"] for r in group) + "\n")
        names = f.name
    try:
        p = rc(
            "copy", f"r2:{first['r2_bucket']}/{first['r2_prefix']}", DEST + root.rstrip("/"),
            "--files-from-raw", names, "--no-traverse", "--size-only", "--transfers", "6",
            "--drive-chunk-size", "64M", "--drive-stop-on-upload-limit", "--retries", "5", "--low-level-retries", "20",
            "-v", "--stats", "30s", "--stats-one-line", "--log-file", str(HERE / "rclone.log"),
        )
    finally:
        os.unlink(names)
    with lock:
        counter[0] += 1
        counter[1] += size
        n, gb = counter
    hours = (time.time() - t0) / 3600
    if p.returncode == FATAL:
        daily_limit.set()
        log(f"Drive stopped accepting uploads at {first['episode_id']}: see rclone.log")
    elif p.returncode:
        log(f"FAILED {first['episode_id']}: see rclone.log")
    else:
        log(f"{n}/{count_all} episodes this run | {gb / 1e9:.1f} GB in {hours:.2f} h")
    return p.returncode


left = []
for attempt in range(1, PASSES + 1):
    left, dupes, extra = state()
    if not left or daily_limit.is_set():
        break
    groups = collections.defaultdict(list)
    for r in left:
        groups[r["episode_id"]].append(r)
    size = sum(int(r["size_bytes"]) for r in left) / 1e9
    log(f"pass {attempt}: {len(rows) - len(left)} files already there, {len(left)} left in {len(groups)} episodes, {size:.1f} GB")
    counter = [0, 0]
    with ThreadPoolExecutor(args.workers) as ex:
        list(ex.map(lambda g: upload(g, counter, len(groups)), groups.values()))

left, dupes, extra = state()
gb = (TOTAL - sum(int(r["size_bytes"]) for r in left)) / 1e9
log(f"DONE in {(time.time() - t0) / 3600:.2f} h | on Drive {len(rows) - len(left)} of {len(rows)} files, {gb:.1f} GB of {TOTAL / 1e9:.1f} GB | left {len(left)} | duplicates {len(dupes)} | files not in the list {len(extra)}")
if daily_limit.is_set():
    print("\nStopped at Drive's daily upload limit (about 750 GB). Wait 24 hours, then run the same command: it carries on from here.")
    sys.exit(2)
if left or dupes:
    for r in left[:10]:
        log(f"  still left: {r['drive_path']}")
    for p in dupes[:10]:
        log(f"  duplicate: {p}")
    print("\nNot finished cleanly. Fix the cause (see rclone.log), then run it again.")
    sys.exit(1)
print("\nAll files are on Drive and every size matches.")
