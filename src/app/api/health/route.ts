// For the load balancer and the container healthcheck. It checks nothing else,
// so a Supabase blip can't get a healthy container replaced.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ ok: true });
}
