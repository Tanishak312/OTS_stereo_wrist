"""Build the episode index for Supabase from the Orion submission sheet.

    python scripts/build_episode_index.py "data/<submission sheet>.csv"

Reads the sheet (one row per trimmed episode), cleans it and writes
data/ots_episodes.csv, whose columns match the ots_episodes table in
supabase/003_episodes_delivery.sql. Import that file through the Supabase
Table Editor (or \\copy). Purely local: it reads the CSV and writes one file.

What it fixes, and why:
  * Domain / skill names come in several spellings ("Food and Beverage",
    "Food And Beverage", "Backyard  Yard"); they are mapped onto the kiosk slugs.
  * The sheet's URLs say .../EGO/stereo.mp4 but the R2 key is .../Ego/...
    (R2 keys are case-sensitive), so only the episode folder is stored and the
    file path is rebuilt from it at download time.
  * Operator id, age, gender, handedness are left out: they never reach a customer.
Rows it cannot place (unknown name, odd path, repeated episode id) are dropped
and listed in the report so they can be fixed at the source.
"""

import re
import sys
from pathlib import Path

import pandas as pd

DOMAINS = {
    "industrial manufacturing": "industrial-manufacturing",
    "food and beverage": "food-beverage",
    "creative workshops": "creative-workshops",
    "clothing and fashion": "clothing-fashion",
    "repair services": "repair-services",
    "sports and recreation": "sports-recreation",
    "construction and hardware": "construction-hardware",
    "retail and consumer goods": "retail-consumer-goods",
    "administrative and office services": "administrative-office",
    "administrative": "administrative-office",
    "beauty and personal care": "beauty-personal-care",
    "agriculture and farming": "agriculture-farming",
    "home": "home",
    "automotive and transport": "automotive-transport",
    "cleaning and sanitation": "cleaning-sanitation",
    "other": "other",
    "hospitality": "hospitality",
    "backyard yard": "backyard-yard",
    "education and training": "education-training",
    "energy and utilities": "energy-utilities",
    "entertainment and events": "entertainment-events",
    "printing and design": "printing-design",
    # In the sheet but not in the v3 doc; the kiosk does not offer them yet.
    "healthcare and pharmacy": "healthcare-pharmacy",
    "warehousing and logistics": "warehousing-logistics",
    "laboratory scientific": "laboratory-scientific",
}

SKILLS = {
    "tool use and technical manipulation": "tool-use",
    "assembly and installation": "assembly",
    "pick and place object handling": "pick-place",
    "cleaning and sanitation": "cleaning",
    "food preparation and cooking": "food-prep",
    "clothing and laundry": "clothing-laundry",
    "repair and maintenance": "repair",
    "packing and bagging": "packing",
    "organization and tidying": "organization",
    "electronics and diagnostics": "electronics",
    "retail and service operations": "retail-service",
    "inventory and stock management": "inventory",
    "construction and building": "construction",
    "construction and buildiung": "construction",
    "mechanical automotive work": "mechanical",
    "dish handling": "dish-handling",
    "healthcare and caregiving": "healthcare",
    "human interaction and handoffs": "handoffs",
    "home appliance interaction": "appliances",
}

URL_COL = "recording_url_segmentation_recording_metadata:recording_url_segmentation_recording_metadata_trimmed_url"
URL_RE = re.compile(r"^https://[^/]+\.r2\.cloudflarestorage\.com/(?P<bucket>[^/]+)/(?P<prefix>.+/)EGO/stereo\.mp4$")
OUT_COLS = [
    "episode_id", "bucket", "prefix", "capture_setup", "domain", "skill", "difficulty",
    "duration_s", "stereo_bytes", "mcap_bytes", "task_name", "location_name", "environment_l2", "environment_l3",
]


def norm(s: str) -> str:
    """'Food And Beverage' / 'Food & Beverage' / 'Backyard  Yard' -> 'food and beverage' / 'backyard yard'."""
    s = str(s).lower().replace("&", " and ")
    return re.sub(r"[^a-z]+", " ", s).strip()


def seconds(hms: str):
    try:
        h, m, s = (int(x) for x in str(hms).split(":"))
        return h * 3600 + m * 60 + s
    except ValueError:
        return None


def main(src: str) -> None:
    df = pd.read_csv(src, dtype=str)
    df.columns = [c.strip() for c in df.columns]
    total = len(df)
    dropped: dict[str, pd.DataFrame] = {}

    def drop(reason: str, mask: pd.Series) -> None:
        nonlocal df
        if mask.any():
            dropped[reason] = df[mask]
            df = df[~mask]

    paths = df[URL_COL].fillna("").str.extract(URL_RE)
    df = df.assign(bucket=paths["bucket"], prefix=paths["prefix"])
    drop("path is not .../EGO/stereo.mp4", df["bucket"].isna())

    df = df.assign(
        domain=df["environment_l1"].map(lambda v: DOMAINS.get(norm(v))),
        skill=df["skill_group"].map(lambda v: SKILLS.get(norm(v))),
        difficulty=df["task_difficulty"].str.strip().str.lower(),
        duration_s=df["session_duration"].map(seconds),
    )
    drop("unknown environment", df["domain"].isna())
    drop("unknown skill group", df["skill"].isna())
    drop("unknown difficulty", ~df["difficulty"].isin(["easy", "medium", "hard"]))
    drop("missing or zero duration", ~(df["duration_s"].fillna(0) > 0))
    # Same id twice (with different durations) — keep the first, report the rest.
    drop("repeated episode id", df["Unique ID"].duplicated())

    mb = pd.to_numeric(df["Stereo Size (MB)"], errors="coerce")
    mcap_mb = pd.to_numeric(df["CRF 16 MCAP Size (MB)"], errors="coerce")
    out = pd.DataFrame({
        "episode_id": df["Unique ID"].str.strip(),
        "bucket": df["bucket"],
        "prefix": df["prefix"],
        "capture_setup": "ego",  # every path in the sheet is the ego rig
        "domain": df["domain"],
        "skill": df["skill"],
        "difficulty": df["difficulty"],
        "duration_s": df["duration_s"].astype(int),
        # The sheet's MB is decimal (matches R2 byte counts), so x 1e6.
        "stereo_bytes": (mb * 1_000_000).round().astype("Int64"),
        "mcap_bytes": (mcap_mb * 1_000_000).round().astype("Int64"),
        "task_name": df["task_name"].str.strip(),
        "location_name": df["location_name"].str.strip(),
        "environment_l2": df["environment_l2"].str.strip(),
        "environment_l3": df["environment_l3"].str.strip(),
    })[OUT_COLS]

    dest = Path(src).with_name("ots_episodes.csv")
    out.to_csv(dest, index=False)

    hours = out["duration_s"].sum() / 3600
    print(f"read {total:,} rows -> wrote {len(out):,} episodes, {hours:,.1f} h to {dest}")
    for reason, rows in dropped.items():
        print(f"  dropped {len(rows):>4}  {reason}: " + ", ".join(rows["Unique ID"].astype(str).head(3)) + (" ..." if len(rows) > 3 else ""))
    print(f"  missing stereo size: {out['stereo_bytes'].isna().sum()}")
    print("\nhours by environment:")
    print((out.groupby("domain")["duration_s"].sum() / 3600).round(1).sort_values(ascending=False).to_string())
    print("\nhours by skill:")
    print((out.groupby("skill")["duration_s"].sum() / 3600).round(1).sort_values(ascending=False).to_string())
    print("\nhours by difficulty:")
    print((out.groupby("difficulty")["duration_s"].sum() / 3600).round(1).to_string())


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
