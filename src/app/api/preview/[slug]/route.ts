import { parseClip, parseSetup, previewResponse } from "@/lib/preview";

// One clip of one environment type's preview: /api/preview/<slug>?setup=<setup>&clip=<n>
// (no ?setup= is Ego-centric, no ?clip= is clip 1). All the R2 work is in lib/preview.ts, on the server.
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

function args(request: Request) {
  const q = new URL(request.url).searchParams;
  return [parseSetup(q.get("setup")), parseClip(q.get("clip"))] as const;
}

export async function GET(request: Request, { params }: Ctx) {
  return previewResponse((await params).slug, ...args(request), request.headers.get("range"));
}

export async function HEAD(request: Request, { params }: Ctx) {
  return previewResponse((await params).slug, ...args(request), request.headers.get("range"), "HEAD");
}
