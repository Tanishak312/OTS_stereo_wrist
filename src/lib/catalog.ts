// Catalog for the off-the-shelf stereo egocentric dataset: names, photos and
// order of the options. The hours/episode numbers the kiosk shows come live from
// the episode index (ots_inventory(), see lib/inventory.ts); the figures below
// are the "Awign_OTS_Stereo Egocentric Dataset - v3" datasheet and are used only
// as a fallback estimate when Supabase can't be reached. Head + wrist is the Axis
// collection (scripts/build_axis_index.py): all "Home", not graded by difficulty.

export const DATASET = {
  usableHours: 4147,
  episodes: 22860,
  taskTypes: 4017,
  // Not in the episode index (operator ids aren't imported); distinct operator-id
  // count from the Orion submission sheet, Nov 2026. Update with the sheet.
  operators: 1015,
  settingTypes: 135,
  workAreas: 307,
  domains: 21,
  skillGroups: 18,
  locations: 18,
  sampleHours: 50,
  delivery: "Stereo MP4 (H.265)",
} as const;

export type SetupId = "ego" | "head_wrist";

export type CaptureSetup = {
  id: SetupId;
  name: string;
  /** Short description; shown with "Coming soon" while the index has no recordings for the setup. */
  detail: string;
  image: string;
  /** What a delivery holds, for the review step. */
  delivery: string;
  /** Recordings are graded easy / medium / hard; when false the difficulty filter is hidden. */
  graded: boolean;
  /**
   * Delivery size per hour of recording, for sizes the episode index can't give.
   * Ego-centric: the index has each video's size, so this is only the fallback
   * (6.2 GB/h = its average with batch 6, 71.8 TB over 11,525 h, Nov 2026).
   * Head + wrist: the Axis sheet has no sizes; 38 GB/h was measured on 20 clips
   * in awign-axis (three videos + calibration, 132 GB for 3.5 h, 2026-11-03).
   */
  gbPerHour: number;
  /**
   * How a delivery changes while MCAP is offered (OFFER_MCAP); null for a
   * setup that has none. gbPerHour is only a fallback, for when the index has no
   * MCAP sizes: an MCAP's size varies a lot by batch (12.2 GB/h on batches 1-5,
   * 17.9 on batch 6).
   */
  mcap: { gbPerHour: number; delivery: string } | null;
};

// Hours and episode counts per setup come from the episode index.
export const SETUPS: CaptureSetup[] = [
  {
    id: "ego",
    name: "Ego-centric",
    detail: "head-mounted stereo",
    image: "/images/step-1-egocentric-repair.jpeg",
    delivery: DATASET.delivery,
    graded: true,
    gbPerHour: 6.2,
    mcap: { gbPerHour: 14, delivery: "MCAP (stereo video, IMU, calibration, transforms, annotations, session details)" },
  },
  {
    id: "head_wrist",
    name: "Head + wrist",
    detail: "hands in view",
    image: "/images/step-1-head-wrist.jpeg",
    delivery: "Head + 2 wrist MP4s, synced + calibration",
    graded: false,
    gbPerHour: 38,
    mcap: null,
  },
];

/** What a delivery of a setup ships and its size counts, free sample or full dataset. */
export function deliveryContents(setup: CaptureSetup, mcapOffered: boolean): { delivery: string; mcapGbPerHour: number } {
  return mcapOffered && setup.mcap ? { delivery: setup.mcap.delivery, mcapGbPerHour: setup.mcap.gbPerHour } : { delivery: setup.delivery, mcapGbPerHour: 0 };
}

export type Domain = {
  slug: string;
  name: string;
  hours: number;
  share: number;
  episodes: number;
  tasks: number;
  /** Card photo in public/; domains without one show a placeholder. */
  image?: string;
  /** Shorter label for chips, where the full name is too long. */
  short?: string;
};

export const DOMAINS: Domain[] = [
  { slug: "industrial-manufacturing", name: "Industrial Manufacturing", hours: 561.3, share: 13.5, episodes: 3023, tasks: 512, image: "/domains/industrial-manufacturing.jpeg" },
  { slug: "food-beverage", name: "Food & Beverage", hours: 558.3, share: 13.5, episodes: 3313, tasks: 630, image: "/domains/food.jpeg" },
  { slug: "creative-workshops", name: "Creative Workshops", hours: 497.6, share: 12.0, episodes: 1821, tasks: 459, image: "/domains/creative.jpeg" },
  { slug: "clothing-fashion", name: "Clothing & Fashion", hours: 399.1, share: 9.6, episodes: 2373, tasks: 157, image: "/domains/fashion.jpeg" },
  { slug: "repair-services", name: "Repair Services", hours: 358.3, share: 8.6, episodes: 1755, tasks: 152, image: "/domains/repair-services.jpeg" },
  { slug: "sports-recreation", name: "Sports & Recreation", hours: 214.3, share: 5.2, episodes: 1208, tasks: 270, image: "/domains/sports.jpeg" },
  { slug: "construction-hardware", name: "Construction & Hardware", hours: 193.0, share: 4.7, episodes: 1398, tasks: 295, image: "/domains/construction.jpeg" },
  { slug: "retail-consumer-goods", name: "Retail & Consumer Goods", hours: 186.5, share: 4.5, episodes: 895, tasks: 257, image: "/domains/retail.jpeg" },
  { slug: "administrative-office", name: "Administrative & Office Services", hours: 185.6, share: 4.5, episodes: 1659, tasks: 382, short: "Administrative & Office" },
  { slug: "beauty-personal-care", name: "Beauty & Personal Care", hours: 162.5, share: 3.9, episodes: 675, tasks: 82 },
  { slug: "agriculture-farming", name: "Agriculture & Farming", hours: 154.1, share: 3.7, episodes: 676, tasks: 141 },
  { slug: "home", name: "Home", hours: 149.8, share: 3.6, episodes: 811, tasks: 287, image: "/domains/home.jpeg" },
  { slug: "automotive-transport", name: "Automotive & Transport", hours: 149.1, share: 3.6, episodes: 785, tasks: 240 },
  { slug: "cleaning-sanitation", name: "Cleaning & Sanitation", hours: 122.7, share: 3.0, episodes: 796, tasks: 225 },
  { slug: "other", name: "Other", hours: 79.1, share: 1.9, episodes: 564, tasks: 92 },
  { slug: "hospitality", name: "Hospitality", hours: 69.4, share: 1.7, episodes: 465, tasks: 92 },
  { slug: "backyard-yard", name: "Backyard / Yard", hours: 56.8, share: 1.4, episodes: 337, tasks: 81 },
  { slug: "education-training", name: "Education & Training", hours: 19.1, share: 0.5, episodes: 110, tasks: 13 },
  { slug: "energy-utilities", name: "Energy & Utilities", hours: 15.3, share: 0.4, episodes: 93, tasks: 49 },
  { slug: "entertainment-events", name: "Entertainment & Events", hours: 14.6, share: 0.4, episodes: 98, tasks: 13 },
  { slug: "printing-design", name: "Printing & Design", hours: 1.1, share: 0.0, episodes: 5, tasks: 3 },
  // In the episode sheet but not in the v3 datasheet (no fallback figures).
  { slug: "healthcare-pharmacy", name: "Healthcare & Pharmacy", hours: 0, share: 0, episodes: 0, tasks: 0 },
  { slug: "warehousing-logistics", name: "Warehousing & Logistics", hours: 0, share: 0, episodes: 0, tasks: 0 },
  { slug: "laboratory-scientific", name: "Laboratory / Scientific", hours: 0, share: 0, episodes: 0, tasks: 0 },
];

export type Skill = {
  slug: string;
  name: string;
  /** Short label used on the kiosk chips. */
  short: string;
  hours: number;
  share: number;
  tasks: number;
};

export const SKILLS: Skill[] = [
  { slug: "tool-use", name: "Tool Use & Technical Manipulation", short: "Tool use & technical", hours: 1001.6, share: 24.1, tasks: 1129 },
  { slug: "assembly", name: "Assembly & Installation", short: "Assembly & installation", hours: 517.8, share: 12.5, tasks: 405 },
  { slug: "pick-place", name: "Pick and Place / Object Handling", short: "Pick & place", hours: 350.7, share: 8.5, tasks: 465 },
  { slug: "cleaning", name: "Cleaning & Sanitation", short: "Cleaning & sanitation", hours: 332.6, share: 8.0, tasks: 534 },
  { slug: "food-prep", name: "Food Preparation & Cooking", short: "Food prep & cooking", hours: 330.9, share: 8.0, tasks: 384 },
  { slug: "clothing-laundry", name: "Clothing & Laundry", short: "Clothing & laundry", hours: 291.9, share: 7.0, tasks: 101 },
  { slug: "repair", name: "Repair & Maintenance", short: "Repair & maintenance", hours: 242.1, share: 5.8, tasks: 218 },
  { slug: "packing", name: "Packing & Bagging", short: "Packing & bagging", hours: 223.9, share: 5.4, tasks: 249 },
  { slug: "organization", name: "Organization & Tidying", short: "Organization & tidying", hours: 171.3, share: 4.1, tasks: 358 },
  { slug: "electronics", name: "Electronics & Diagnostics", short: "Electronics & diagnostics", hours: 162.5, share: 3.9, tasks: 103 },
  { slug: "retail-service", name: "Retail & Service Operations", short: "Retail & service ops", hours: 133.0, share: 3.2, tasks: 62 },
  { slug: "inventory", name: "Inventory & Stock Management", short: "Inventory & stock", hours: 130.8, share: 3.2, tasks: 130 },
  { slug: "construction", name: "Construction & Building", short: "Construction & building", hours: 126.4, share: 3.0, tasks: 153 },
  { slug: "mechanical", name: "Mechanical / Automotive Work", short: "Mechanical & automotive", hours: 99.4, share: 2.4, tasks: 145 },
  { slug: "dish-handling", name: "Dish Handling", short: "Dish handling", hours: 15.1, share: 0.4, tasks: 18 },
  { slug: "healthcare", name: "Healthcare & Caregiving", short: "Healthcare & caregiving", hours: 7.7, share: 0.2, tasks: 21 },
  { slug: "handoffs", name: "Human Interaction & Handoffs", short: "Human handoffs", hours: 5.9, share: 0.1, tasks: 22 },
  { slug: "appliances", name: "Home Appliance Interaction", short: "Home appliances", hours: 3.7, share: 0.1, tasks: 8 },
  // Head + wrist only (Axis "Plant & Pet Care"); not in the v3 datasheet, so no fallback figures.
  { slug: "plant-care", name: "Plant & Pet Care", short: "Plant & pet care", hours: 0, share: 0, tasks: 0 },
];

export type DifficultyId = "easy" | "medium" | "hard";

export const DIFFICULTIES: { id: DifficultyId; name: string; share: number; hours: number }[] = [
  { id: "easy", name: "Easy", share: 20.2, hours: 838 },
  { id: "medium", name: "Medium", share: 51.9, hours: 2152 },
  { id: "hard", name: "Hard", share: 27.9, hours: 1157 },
];

export const HARDWARE_SPECS: [string, string][] = [
  ["Camera configuration", "Binocular stereo, two synchronised image sensors"],
  ["Image sensor", "SmartSens SC233HGS, global shutter"],
  ["Resolution", "1920 × 1080 per eye; 3840 × 1080 combined stereo frame"],
  ["Frame rate", "30 fps"],
  ["Field of view", "112.1° HFOV / 79.7° VFOV / 119.1° DFOV"],
  ["Stereo baseline", "60.39 mm; near-parallel eye alignment"],
  ["Inertial sensor", "TDK InvenSense ICM-42688-P, 6-axis"],
  ["IMU sampling", "501 Hz default; configurable"],
  ["Video / IMU sync", "Shared-clock timestamping; sub-millisecond precision"],
  ["Video encoding", "H.265 / HEVC, hardware encoded; MP4 source"],
];

export const DATA_PACKAGE: [string, string][] = [
  ["Stereo video", "*.mp4, H.265 stereo, 3840 × 1080 @ 30 fps"],
  ["Frame index", "frames.idx.csv"],
  ["IMU log", "imu.csv"],
  ["Calibration", "calibration.json + stereo_calibration.bin"],
  ["Device metadata", "meta.json"],
  ["Dataset delivery", "MCAP with session / episode metadata"],
];

// Landing page. Ego-centric figures are the v3 datasheet's; head + wrist were
// measured on the awign-axis files (2026-11-03), which give no camera model or frame rate.
export const DEVICES: { id: SetupId; name: string; summary: string; image: string; specs: [string, string][] }[] = [
  {
    id: "ego",
    name: "Ego-centric rig",
    summary: "A lightweight stereo camera on a cap, close to natural eye level.",
    image: "/images/step-1-egocentric-repair.jpeg",
    specs: [
      ["Cameras", "2 synchronised, global shutter"],
      ["Resolution", "1920 × 1080 per eye"],
      ["Frame rate", "30 fps"],
      ["Field of view", "112° horizontal, 80° vertical"],
      ["Stereo baseline", "60.4 mm"],
      ["Motion", "6-axis IMU at 501 Hz"],
      ["Sync", "Sub-millisecond, shared clock"],
      ["Video", "H.265 / HEVC"],
    ],
  },
  {
    id: "head_wrist",
    name: "Head + wrist rig",
    summary: "A head camera plus one on each wrist, so the hands stay in view.",
    image: "/images/step-1-head-wrist.jpeg",
    specs: [
      ["Cameras", "3: head, left wrist, right wrist"],
      ["Head camera", "Stereo, 3840 × 1200"],
      ["Wrist cameras", "1920 × 1200 each"],
      ["Motion", "IMU and magnetometer per camera"],
      ["Calibration", "Per camera"],
      ["Sync", "All three videos time-synchronised"],
      ["Video", "H.264"],
    ],
  },
];

// The channels of real session.mcap files (read from three files, 2026-11-04).
export const MCAP_CONTENTS: [string, string][] = [
  ["Stereo video", "Left and right cameras, at 30 fps."],
  ["IMU", "Accelerometer and gyroscope, about 500 samples a second."],
  ["Camera calibration", "Intrinsics and distortion for each camera."],
  ["Transforms", "How the cameras are placed relative to each other."],
  ["Task annotation", "What's being done in the recording."],
  ["Environment and session details", "Where the task took place, and how it was recorded."],
];

export const FAQS: [string, string][] = [
  ["How do I get the free sample?", "Leave your details. For Ego-centric we email you a Google Drive link right away. For Head + wrist we email you access as soon as your sample is ready."],
  ["What's in the sample?", "About 50 hours of recordings. Ego-centric comes as MCAP files, which already include the video. Head + wrist comes as MP4 videos with calibration."],
  ["How is the full dataset delivered?", "We put the data you picked in a private cloud bucket and email you its access keys."],
  ["How do I download it?", "With any S3-compatible tool, such as the AWS CLI or rclone. The email has the command."],
  ["How long does it take?", "You get a confirmation by email right away. Your access details follow when the data is ready; bigger selections take longer."],
  ["Can I choose what I get?", "Yes. Pick your environments, then the skills you need inside each one."],
  ["How is the data licensed?", "It's available for non-exclusive licensing."],
];

const bySlug = <T extends { slug: string }>(list: T[]) =>
  Object.fromEntries(list.map((x) => [x.slug, x])) as Record<string, T>;

export const DOMAIN_BY_SLUG = bySlug(DOMAINS);
export const SKILL_BY_SLUG = bySlug(SKILLS);
export const SETUP_BY_ID = Object.fromEntries(SETUPS.map((s) => [s.id, s])) as Record<SetupId, CaptureSetup>;
export const DIFFICULTY_BY_ID = Object.fromEntries(DIFFICULTIES.map((d) => [d.id, d])) as Record<DifficultyId, (typeof DIFFICULTIES)[number]>;

// Names for slugs from the episode sheet, including ones the catalog doesn't list yet.
const prettySlug = (slug: string) => slug.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());
export const domainName = (slug: string) => DOMAIN_BY_SLUG[slug]?.name ?? prettySlug(slug);
export const skillName = (slug: string) => SKILL_BY_SLUG[slug]?.name ?? prettySlug(slug);
