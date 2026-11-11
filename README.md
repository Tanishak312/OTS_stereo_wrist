# OTS live — booth kiosk + admin

Two apps in one Next.js project:

| Path | Who | What |
|---|---|---|
| `/` | Visitor at the booth kiosk (1080×1920 portrait touch screen) | A landing page (devices, coverage, what's in an MCAP, FAQ), then pick capture setup → environments → skills inside each environment → review → leave contact details. Either gets a **free 50-hour sample** (a Google Drive link, no approval) or **requests the full dataset** (an admin fills an R2 bucket and emails its access). |
| `/admin` | Awign team | See what each customer asked for, per environment and skill; send them their bucket access, or reject with a note; track free samples. Full history per request. |
| `/admin/catalog` | Awign team | The same live numbers the kiosk shows, per setup / environment / skill. |

Design source: Figma "awign Booth Kiosk – Robotics Data" (kiosk screens) and the
Booth Operator Dashboard mock (admin). Data source: *Awign_OTS_Stereo Egocentric
Dataset – v3* (Google Doc) → [src/lib/catalog.ts](src/lib/catalog.ts).

Deploying to AWS with Docker: see [DEPLOY_AWS.md](DEPLOY_AWS.md). The older E2E Networks steps are in [DEPLOY_E2E.md](DEPLOY_E2E.md).

## Run locally

```bash
npm install
npm run dev        # http://localhost:3010
```

`.env`:

| Variable | Needed for | Notes |
|---|---|---|
| `SUPABASE_ANON_PUBLIC` | everything | `SUPABASE_URL` is optional (derived from the key). |
| `RESEND_API_KEY` | every email | A *sending-access* key is enough. |
| `EMAIL_FROM` | every email | e.g. `Awign Robotics Data <data@awign.in>`, on a domain verified in Resend. Until then Resend only delivers to its own account address. |
| `SAMPLE_DRIVE_URL_EGO` | free sample, Ego-centric | The Google Drive folder, shared as "anyone with the link can view". Until it's set, samples stay **Pending delivery** with the reason on the admin page. |
| `OFFER_MCAP` | sizes of full datasets | Off unless `true`; on since Nov 2026. Each `session.mcap` embeds operator id, age range, gender, handedness, city, business name and location (more than the datasheet's "anonymised operator ID and job / role"), and the sample's Drive folder holds these same files with no approval in front of it. |
| `R2_ENDPOINT` | bucket access email | Optional; defaults to our R2 account. |

The site itself never touches R2. `R2_READ_ACCESS_KEY_ID` / `R2_READ_SECRET_ACCESS_KEY` are only for the
`scripts/build_*.py` index builders, run on your own machine.

**`SUPABASE_SERVICE_ROLE` and any R2 write key are never read by the code** —
keep them out of any deployed environment.

## One-time Supabase setup (run by the project owner)

These change the live Supabase project, so they are run by hand in the Supabase
dashboard, not by the app.

1. **SQL editor → run [supabase/001_init.sql](supabase/001_init.sql).**
   Creates `ots_requests`, `ots_request_events`, `ots_admins`, the
   `ots_request_seq` sequence (tokens start at `OTS-1001`), RLS policies, and
   `submit_ots_request(...)` — the only thing the anon key can do (insert one request).
2. **SQL editor → run [supabase/002_review_rules.sql](supabase/002_review_rules.sql).**
   `set_ots_request_status(token, status, note)` — admins only, logs every change,
   and enforces the two lifecycles below.
   Both files are re-runnable. Undo with [supabase/999_rollback.sql](supabase/999_rollback.sql) (drops everything, data included).
3. **SQL editor → run [supabase/003_episodes_delivery.sql](supabase/003_episodes_delivery.sql)**,
   then load the episode index:
   ```bash
   python scripts/build_episode_index.py "data/<submission sheet>.csv"   # writes data/ots_episodes.csv
   ```
   Table Editor → `ots_episodes` → Insert → *Import data from CSV* → `data/ots_episodes.csv`.
   Re-run both when a new submission sheet arrives (clear the table first:
   `truncate public.ots_episodes cascade;` only if no delivery should be kept —
   otherwise import just the new rows).
4. **SQL editor → run [supabase/004_dataset_delivery.sql](supabase/004_dataset_delivery.sql).**
   Full-dataset delivery on approval, and R2 links that stay valid for the whole
   7-day delivery. Run files in number order; when the app logs `PGRST202`, the
   database is behind the code — run the newest SQL file again.
5. **SQL editor → run [supabase/005_inventory.sql](supabase/005_inventory.sql).**
   `ots_inventory()`: live totals per setup × environment × skill × difficulty,
   which every number on the kiosk comes from. Also lets a request pick any of
   the 24 environments in the index.
6. **SQL editor → run [supabase/006_s3_delivery.sql](supabase/006_s3_delivery.sql), then
   [supabase/007_mapped_delivery.sql](supabase/007_mapped_delivery.sql)** (in that order).
   006: "Send to my S3 bucket" on the dataset form (bucket details on `ots_requests`,
   the customer's secret key encrypted in its own table no one can select from).
   007: `ots_delivery_episodes()`, which the download page's link list, manifest and
   one-click episode ZIP read. Run both **before** deploying the code that uses them.
   Then [supabase/008_s3_transfer_jobs.sql](supabase/008_s3_transfer_jobs.sql) for the "Start S3 copy" button and its worker.
   Then [supabase/009_head_wrist.sql](supabase/009_head_wrist.sql) and the **head + wrist (Axis)** index:
   ```bash
   python scripts/build_axis_index.py "data/<Axis submission sheet>.csv"   # writes data/ots_episodes_axis.csv
   ```
   Table Editor -> `ots_episodes` -> Insert -> *Import data from CSV* -> `data/ots_episodes_axis.csv`
   (adds rows; the Orion ones stay). All of it is the "Home" environment, skills mapped from the
   sheet's categories, difficulty left empty (the kiosk hides that filter for head + wrist), and
   no location columns. The R2 **read** key must be able to read the `awign-axis` bucket (it can, checked
   2026-11-03). Each clip folder holds the three synced H.264 videos plus per-camera calibration and IMU;
   what reaches a customer is the list in [What goes in the bucket](#what-goes-in-the-bucket)
   (never location_metadata.json or submission_analytics.json). Head + wrist is big: about 38 GB per
   hour of recording (three videos), so ~120 TB for all of it.
7. **SQL editor → run [supabase/010_inventory_summary.sql](supabase/010_inventory_summary.sql).**
   The kiosk's totals now come from a summary table that triggers keep up to date, so an
   import shows up by itself and needs no refresh. Run it before the next import.
   **New Orion batches** come as two sheets, joined on `lead_id`:
   ```bash
   python scripts/build_orion_batch_index.py --clips "data/<clip sheet>.csv" \
       --metadata "data/<metadata sheet>.csv" --out data/ots_episodes_batch<N>.csv
   ```
   It writes only rows that aren't in `data/ots_episodes*.csv` yet, and lists each clip's folder
   in R2 with the read-only key for the real video size. A clip without a video or calibration
   is left out and reported. Then Table Editor -> `ots_episodes` -> Insert -> *Import data from CSV*
   (adds rows). Keep the file in `data/`: the next batch reads it to skip what's already imported.
   Batch 6's metadata sheet has a wrong `task_difficulty` on ~32% of clips, so difficulty comes
   from each clip's `task_id` (the two agree 99.1% on batches 1-5).
8. **MCAP.** SQL editor → run [supabase/011_mcap_delivery.sql](supabase/011_mcap_delivery.sql) and
   [supabase/013_sample_mcap.sql](supabase/013_sample_mcap.sql), then
   ```bash
   python scripts/build_mcap_sizes.py     # writes data/ots_episode_mcap_sizes.csv, read-only on R2
   ```
   Table Editor → `ots_episode_mcap_sizes` → Insert → *Import data from CSV* → that file, then run
   [supabase/012_apply_mcap_sizes.sql](supabase/012_apply_mcap_sizes.sql). Once 011 has run, new batch CSVs
   carry `mcap_bytes` themselves, so this step isn't needed for them.
9. **Delivery.** SQL editor → run [supabase/014_manual_delivery.sql](supabase/014_manual_delivery.sql), at the
   same time as deploying this code. It adds the columns below and switches off the old delivery
   functions; no row is changed or deleted. (006-008 and the delivery half of 003, 004, 011, 013 are
   history now: the tables stay, nothing calls them.)
10. Don't run [supabase/900_demo_seed.sql](supabase/900_demo_seed.sql) on a real project. Its 6 demo rows
   (`is_demo = true`, example.com emails) never show in the admin list anyway. Remove them with
   `delete from public.ots_requests where is_demo;`.
11. **Authentication → Users → Add user** for the shared admin account (email + password). `/admin/login` asks for both; neither goes in `.env` or the server config.
12. Put it on the admin list:
   ```sql
   insert into public.ots_admins (user_id, email)
   select id, email from auth.users where email = 'someone@awign.com';
   ```

## Request lifecycle

Two kinds of request, two paths:

```
Full dataset
  submitted (New) ──► in_review ──► approved (Access sent)
        │                │
        └────────────────┴──► rejected (note required) ──► in_review (reopen)

Free 50 h sample, Ego-centric (no approval)
  submitted (Pending delivery) ──► sample_sent (Sent)

Free 50 h sample, head + wrist (no approval)
  submitted (Pending delivery) ── admin emails bucket access ──► sample_sent (Sent)
```

**Head + wrist sample:** it has no Drive folder. Right after submit, Resend emails the visitor that
the sample is being prepared, and the request stays **Pending delivery**. An admin then emails the keys
of one shared R2 bucket from the request page, which marks it **Sent**. Everyone shares that bucket's
token, so replacing it means every customer's old key stops working. Needs
[supabase/015_head_wrist_sample_bucket.sql](supabase/015_head_wrist_sample_bucket.sql), run before the
code that uses it.

**Model/robot training:** the details form asks "Do you want this data for your model/robot
training?", Yes or No, and won't send without an answer. The admin list shows it under the type,
and the request page as **Model/robot training**; requests made before the question read **Not
asked**. (It replaced an earlier "for your lab?" checkbox; any answers to that stay in
`for_own_lab` and still show.) Needs [supabase/016_intended_use.sql](supabase/016_intended_use.sql),
run before the code that sends it.

**Ego-centric sample** ([src/lib/delivery.ts](src/lib/delivery.ts)): right after submit, Resend emails the
visitor the Google Drive folder (`SAMPLE_DRIVE_URL_EGO`). It's a fixed folder of MCAP
files, the same for everyone, so what they picked on the kiosk doesn't change what they get; it's still
stored on the request. Success marks the request **Sent**. A failure (link not set, email refused) leaves
it **Pending delivery** with the reason on the request page, which has **Send again** and, if it was
sent by hand, a button to mark it sent.

**Full dataset:**

1. Skills are chosen per environment on the kiosk (`Selection.skills`, by environment slug). All of
   them start selected and the visitor removes what they don't need; an environment with none left
   drops out of the request. On submit, the customer is emailed a confirmation, and
   the request stores a snapshot of what it covers, which is the only place those pairs are kept
   (`ots_requests.skills` just lists every skill named): total size, and each environment with its hours, episodes and size, and within it each
   skill with that environment's hours (`ots_requests.breakdown`). The numbers stay as the customer
   saw them when a new batch is imported later.
2. The request page shows that breakdown. **Download the file list** gives a CSV of every matching
   episode with where its files sit in R2.
3. By hand: create a bucket in R2, copy the files in, and create an R2 API token that is **Object Read
   only, for this bucket only**. See [What goes in the bucket](#what-goes-in-the-bucket).
4. Paste the bucket name and the token's S3 credentials on the request page and press **Email access**.
   The email goes out first; only then is the request marked **Access sent**, so a failed email changes
   nothing and the form keeps what was typed. **Send new access** covers a replaced key.

The secret key goes in that email and nowhere else in this app: it isn't in Supabase or the logs. Only
the bucket name and access key ID are kept, so a sent key can be found and revoked. **Resend does keep a
copy of what it sends** for a while, which is why the token must be read-only and tied to one bucket.

A dataset can only reach **Access sent** by sending access; `set_ots_request_status()` refuses a plain
approve. A rejection is admin-only: the customer isn't emailed about it.

## What goes in the bucket

The file list has `video_keys`, `mcap_key` and `calibration_folders`. **Never copy a whole episode folder.**
The same `Ego/` folder holds `oms_session.json` (operator name and mobile), `task_metadata.json` (age,
gender, height, geohash), `recording_metadata.json` (latitude/longitude, user id) and selfies.

From a calibration folder, copy only these. Recordings differ, so not every file exists in every episode:

| Setup | Files |
|---|---|
| Ego-centric (`Ego/`) | `calibration.json`, `stereo_calibration.json`, `stereo_calibration.bin`, `factory_calibration.json`, `camera_to_imu_extrinsics.json`, `updated_intrinsics.json`, `updated_extrinsics.json`, `imu_noise_profile.json`, `imu.imu`, `frames.idx`, `video_timestamps.json`, `meta.json`, `stereo_session_meta.json` |
| Head + wrist (`head/`, `wrist_left/`, `wrist_right/`) | `calibration.json`, `calibration.bin`, `updated_calibration.json`, `device.json`, `imu.csv`, `mag.csv`, `frames.csv` |

A new file type stays out until someone checks it and adds it here. Head + wrist has no MCAP, and is big:
about 38 GB per hour of recording.

The old download page, presigned links, S3 copy and worker are in [archive/old-delivery/](archive/old-delivery/), not built or deployed.

## Things to know

- **The left card on every step** is one component, [src/components/kiosk/SelectionPanel.tsx](src/components/kiosk/SelectionPanel.tsx). Change it there, not per step.
- **Landing page copy** (devices, MCAP contents, FAQ) lives in [src/lib/catalog.ts](src/lib/catalog.ts). The MCAP list comes from the channels of real files; head + wrist specs were measured on the files, so they have no camera model or frame rate.
- **Kiosk numbers are live and exact.** The page loads `ots_inventory()` (cached
  5 minutes, [src/lib/inventory-server.ts](src/lib/inventory-server.ts)) and every hour figure
  is a sum over its cells ([src/lib/inventory.ts](src/lib/inventory.ts)), so any combination
  of picks shows what is really there (Food & Beverage × Tool use = 5.5 h, not the
  ~135 h the old datasheet estimate gave). Chips and cards with no recordings under
  the current picks are disabled; a setup with none (Head + wrist today) shows
  "Coming soon". The server recomputes hours the same way on submit. If Supabase
  can't serve the inventory, the kiosk falls back to the v3 datasheet estimate,
  says "Estimate" on the review screen, and logs why.
- **Operators (1,015)** is the one landing figure not in the index (operator ids
  aren't imported); it lives in [src/lib/catalog.ts](src/lib/catalog.ts) — update it with the sheet.
- **Episode sheet quirks** handled by `scripts/build_episode_index.py`: mixed
  spellings of domain/skill names, `EGO` vs the real `Ego` folder in R2 paths,
  repeated episode ids. Operator id, age, gender and handedness are not imported.
- **Photos:** paths live in [src/lib/catalog.ts](src/lib/catalog.ts) (setups, domains) and
  [src/components/kiosk/Landing.tsx](src/components/kiosk/Landing.tsx). Anything without a file shows a grey placeholder.
  - Landing: `public/images/robot-hand.jpeg`, `public/images/hero-section-explore-dataset.jpeg`
    (the explore artwork has its title, badge and arrow baked in, so nothing is overlaid).
  - Step 1: `public/images/step-1-egocentric-repair.jpeg`, `public/images/step-1-head.jpeg`.
  - Step 2: `public/domains/*.jpeg` — 8 of 21 domains so far (the ones visible before "View all").
- **Motion:** one easing and a small set of entrances in [src/app/globals.css](src/app/globals.css)
  (`animate-fade-up`, `-enter-forward/back`, `-pop`, …) plus `stagger()` / `useCountUp()` in
  [src/lib/motion.ts](src/lib/motion.ts). Everything turns off under `prefers-reduced-motion`.
- **Logo:** `public/images/awign-logo.png` (from the design team).
- **Layouts:** desktop (≥1024 px) follows the 1440 Figma frames; below that is the earlier mobile layout until mobile/tablet frames arrive.
- **Kiosk idle reset:** 90 s without a touch shows "Still there?", then clears the
  screen after 20 s so the next visitor never sees someone else's email.
- No rate limiting on kiosk submissions yet.
