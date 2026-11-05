"""Build the head + wrist (Axis) episode index for Supabase from the Axis submission sheet.

    python scripts/build_axis_index.py "data/<Axis submission sheet>.csv"

Writes data/ots_episodes_axis.csv, with the same columns as the ots_episodes
table (supabase/003_episodes_delivery.sql) and data/ots_episodes.csv, so it is
imported the same way: Table Editor -> ots_episodes -> Insert -> Import data
from CSV. Run supabase/009_head_wrist.sql first (difficulty may be empty).
Purely local: reads the CSV and writes one file.

One row of the sheet is one recording; it is trimmed into one or more clips
(44 rows hold JSON lists of 2-4). Each clip is its own folder in the
awign-axis bucket, holding three time-synced videos:

    <rig>_<date>_<time>_<n>/head/head_synced.mp4
                            wrist_left/wrist_left_synced.mp4
                            wrist_right/wrist_right_synced.mp4

and each clip becomes one episode, id = its folder name.

What it decides, and why:
  * Environment: every Axis task is a household one, so all of it is "home".
  * Skill: the sheet's category, mapped onto the kiosk's skill chips
    (CATEGORY_SKILL), with a few tasks moved where their category is too broad
    (TASK_SKILL: packing a bag/box is Packing, mending is Repair). "Plant & Pet
    Care" matches no existing chip and gets its own, "plant-care".
  * Difficulty: not in the sheet, left empty (the kiosk hides that filter).
  * Duration: to_time - from_time of the clip, the same on all three streams.
  * Latitude, longitude, location name and geohash are NOT copied: they are
    where the recorder lives and never reach a customer.
  * A clip is kept only if all three streams say is_usable and status success,
    and its three videos sit in the same folder.
Rows it cannot place are dropped and listed in the report.
"""

import csv
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

CATEGORY_SKILL = {
    "Laundry & Textiles": "clothing-laundry",
    "Food & Meal Tasks": "food-prep",
    "Cleaning & Waste": "cleaning",
    "Organization & Storage": "organization",
    "Dishwashing": "dish-handling",
    "Assembly & Light Maintenance": "assembly",
    "Setup & Arrangement": "organization",
    "Crafts & Handiwork": "tool-use",
    "Plant & Pet Care": "plant-care",
    "Household Controls & Fixtures": "appliances",
    "Manufacturing & Processing": "tool-use",
    "Inspection & Inventory": "inventory",
    "Retrieval & Delivery": "pick-place",
}

# Tasks whose category is broader than the task itself.
TASK_SKILL = {
    "Load, unload, pack, or unpack a bag, box, bin, luggage, or storage container": "packing",
    "Wrap or package an item in paper, film, or fabric": "packing",
    "Package or fill goods into retail packaging": "packing",
    "Repair or mend a minor damaged item": "repair",
    "Replace or replenish a simple user-serviceable component or device consumable": "repair",
}

BUCKET = "awign-axis"
STREAMS = {
    "head": "recording_url_segmentation_recording_metadata:recording_url_segmentation_recording_metadata_",
    "wrist_left": "left_wrist_recording_url_segmentation_recording_metadata:left_wrist_recording_url_segmentation_recording_metadata_",
    "wrist_right": "right_wrist_recording_url_segmentation_recording_metadata:right_wrist_recording_url_segmentation_recording_metadata_",
}
FILE = {"head": "head/head_synced.mp4", "wrist_left": "wrist_left/wrist_left_synced.mp4", "wrist_right": "wrist_right/wrist_right_synced.mp4"}
URL = re.compile(r"^https://[0-9a-f]+\.r2\.cloudflarestorage\.com/" + BUCKET + r"/([^/]+)/(.+)$")
COLUMNS = ["episode_id", "bucket", "prefix", "capture_setup", "domain", "skill", "difficulty", "duration_s",
           "stereo_bytes", "task_name", "location_name", "environment_l2", "environment_l3"]


def as_list(value: str):
    """A cell holds one value, or a JSON-ish list for a recording trimmed into several clips ("[1.5, 79.7]", "[true, nil]")."""
    v = value.strip()
    if v.startswith("["):
        return json.loads(v.replace("nil", "null"))
    return [v]


def truthy(v) -> bool:
    return v is True or str(v).strip().lower() == "true"


def main(src: str) -> None:
    rows = list(csv.DictReader(open(src, encoding="utf-8-sig")))
    out, dropped, seen = [], Counter(), set()
    skill_hours = defaultdict(float)

    for r in rows:
        category, task = r["category"].strip(), r["task"].strip()
        skill = TASK_SKILL.get(task) or CATEGORY_SKILL.get(category)
        if not skill:
            dropped[f"unknown category: {category!r}"] += 1
            continue
        try:
            seg = {s: {k: as_list(r[p + k]) for k in ("from_time", "to_time", "trimmed_url", "is_usable", "status")} for s, p in STREAMS.items()}
        except (json.JSONDecodeError, KeyError) as e:
            dropped[f"unreadable segment cells ({type(e).__name__})"] += 1
            continue
        n = len(seg["head"]["trimmed_url"])
        if any(len(seg[s][k]) != n for s in STREAMS for k in seg[s]):
            dropped["streams have different clip counts"] += 1
            continue

        for i in range(n):
            folders, ok = set(), True
            for s in STREAMS:
                m = URL.match(str(seg[s]["trimmed_url"][i] or "").strip())
                if not m or m.group(2) != FILE[s]:
                    ok = False
                    dropped[f"{s} url not in the expected place"] += 1
                    break
                folders.add(m.group(1))
                if not truthy(seg[s]["is_usable"][i]) or str(seg[s]["status"][i]).strip().lower() != "success":
                    ok = False
                    dropped["not usable / not success"] += 1
                    break
            if not ok:
                continue
            if len(folders) != 1:
                dropped["head and wrists in different folders"] += 1
                continue
            folder = folders.pop()
            if folder in seen:
                dropped["repeated clip folder"] += 1
                continue
            try:
                duration = round(float(seg["head"]["to_time"][i]) - float(seg["head"]["from_time"][i]))
            except (TypeError, ValueError):
                dropped["unreadable from/to time"] += 1
                continue
            if duration <= 0:
                dropped["zero or negative duration"] += 1
                continue
            seen.add(folder)
            skill_hours[skill] += duration / 3600
            out.append({
                "episode_id": folder,
                "bucket": BUCKET,
                "prefix": folder + "/",
                "capture_setup": "head_wrist",
                "domain": "home",
                "skill": skill,
                "difficulty": "",
                "duration_s": duration,
                "stereo_bytes": "",
                "task_name": task,
                "location_name": "",
                "environment_l2": "",
                "environment_l3": "",
            })

    dest = Path(src).parent / "ots_episodes_axis.csv"
    with open(dest, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS)
        w.writeheader()
        w.writerows(out)

    total = sum(e["duration_s"] for e in out) / 3600
    print(f"{len(rows)} sheet rows -> {len(out)} episodes, {total:,.1f} h -> {dest}")
    for skill, h in sorted(skill_hours.items(), key=lambda x: -x[1]):
        print(f"  {skill:18} {h:8.1f} h")
    if dropped:
        print("dropped:")
        for why, n in dropped.most_common():
            print(f"  {n:6}  {why}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
