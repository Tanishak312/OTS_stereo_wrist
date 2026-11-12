import { parseClip, previewResponse } from "@/lib/preview";

// One clip of one environment type's preview: /api/preview/<slug>?clip=<n> (no ?clip= is clip 1).
// All the R2 work is in lib/preview.ts, on the server.
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

const clipOf = (request: Request) => parseClip(new URL(request.url).searchParams.get("clip"));

export async function GET(request: Request, { params }: Ctx) {
  return previewResponse((await params).slug, clipOf(request), request.headers.get("range"));
}

export async function HEAD(request: Request, { params }: Ctx) {
  return previewResponse((await params).slug, clipOf(request), request.headers.get("range"), "HEAD");
}
