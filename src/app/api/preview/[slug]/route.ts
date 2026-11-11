import { previewResponse } from "@/lib/preview";

// One environment type's preview video. All the R2 work is in lib/preview.ts, on the server.
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(request: Request, { params }: Ctx) {
  return previewResponse((await params).slug, request.headers.get("range"));
}

export async function HEAD(request: Request, { params }: Ctx) {
  return previewResponse((await params).slug, request.headers.get("range"), "HEAD");
}
