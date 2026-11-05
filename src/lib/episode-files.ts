// Where one episode's files sit in R2, relative to its folder (ots_episodes.prefix).
// For the file list an admin copies a dataset from.

/**
 * What goes to a customer from each episode. Calibration is a folder because
 * recordings differ, and only part of it may be copied: the same Ego/ folder
 * holds oms_session.json (operator name and mobile), task_metadata.json (age,
 * gender, height, geohash), recording_metadata.json (latitude/longitude, user
 * id) and selfies. README lists the files that are safe to send.
 */
const FILES: Record<string, { videos: string[]; mcap: string | null; calibration: string[] }> = {
  ego: {
    videos: ["Ego/stereo.mp4"],
    mcap: "OutputsCrf16/session.mcap",
    calibration: ["Ego/"],
  },
  head_wrist: {
    videos: ["head/head_synced.mp4", "wrist_left/wrist_left_synced.mp4", "wrist_right/wrist_right_synced.mp4"],
    mcap: null,
    calibration: ["head/", "wrist_left/", "wrist_right/"],
  },
};

export const episodeFiles = (setup: string) => FILES[setup] ?? FILES.ego;

/** One CSV cell, quoted when it has to be. */
export function csvCell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
