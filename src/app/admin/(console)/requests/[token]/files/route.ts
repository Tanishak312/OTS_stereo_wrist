import { NextResponse } from "next/server";
import { domainName, skillName } from "@/lib/catalog";
import { csvCell, episodeFiles } from "@/lib/episode-files";
import type { BreakdownEnvironment } from "@/lib/selection";
import { adminClient } from "@/lib/supabase";

// Every episode a dataset request matches, with where its files sit in R2: what
// an admin copies into the customer's bucket. Read-only, and it doesn't touch R2.
// Admins only (route handlers don't get the console layout's sign-in check).

export const dynamic = "force-dynamic";

const PAGE = 1000;
const HEAD = [
  "environment", "skill", "difficulty", "task", "episode_id", "duration_s", "video_bytes", "mcap_bytes",
  "source_bucket", "video_keys", "mcap_key", "calibration_folders",
];

type Row = {
  episode_id: string;
  bucket: string;
  prefix: string;
  domain: string;
  skill: string;
  difficulty: string | null;
  task_name: string | null;
  duration_s: number;
  stereo_bytes: number | null;
  mcap_bytes: number | null;
};

const fail = (status: number, message: string) => new NextResponse(message, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const token = decodeURIComponent((await params).token);
  const supabase = await adminClient();

  const admin = await supabase.rpc("is_ots_admin");
  if (admin.error || admin.data !== true) return fail(403, "Sign in as an OTS admin to download a file list.");

  const req = await supabase.from("ots_requests").select("capture_setup, environments, skills, difficulties, breakdown").eq("token", token).maybeSingle();
  if (req.error) return fail(503, `Couldn't load ${token}: ${req.error.message}`);
  if (!req.data) return fail(404, `No request ${token}.`);
  const r = req.data;
  // Skills are picked per environment, and the breakdown keeps which goes with which. Requests from
  // before 014 have none: their one list of skills applied to every environment.
  const pairs = r.breakdown ? new Set((r.breakdown as BreakdownEnvironment[]).flatMap((e) => e.skills.map((s) => `${e.domain}|${s.skill}`))) : null;

  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabase
      .from("ots_episodes")
      .select("episode_id, bucket, prefix, domain, skill, difficulty, task_name, duration_s, stereo_bytes, mcap_bytes")
      .eq("capture_setup", r.capture_setup)
      .in("domain", r.environments);
    // No pick means everything, the same rule as the kiosk's hours.
    if (!pairs && r.skills.length) q = q.in("skill", r.skills);
    if (r.difficulties.length) q = q.in("difficulty", r.difficulties);
    const page = await q.order("domain").order("skill").order("episode_id").range(from, from + PAGE - 1);
    // A partial list would quietly leave data out of the bucket, so all or nothing.
    if (page.error) return fail(503, `Couldn't load the episodes: ${page.error.message}`);
    rows.push(...(page.data as Row[]).filter((e) => !pairs || pairs.has(`${e.domain}|${e.skill}`)));
    if (page.data.length < PAGE) break;
  }

  const files = episodeFiles(r.capture_setup);
  const lines = rows.map((e) =>
    [
      domainName(e.domain),
      skillName(e.skill),
      e.difficulty ?? "not graded",
      e.task_name,
      e.episode_id,
      e.duration_s,
      e.stereo_bytes,
      e.mcap_bytes,
      e.bucket,
      files.videos.map((v) => e.prefix + v).join(" "),
      files.mcap ? e.prefix + files.mcap : "",
      files.calibration.map((c) => e.prefix + c).join(" "),
    ]
      .map(csvCell)
      .join(","),
  );

  return new NextResponse([HEAD.join(","), ...lines].join("\n") + "\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${token}-files.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
