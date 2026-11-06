import { FACILITATOR_URL } from "@/lib/server/env";

export const dynamic = "force-dynamic";

const ALLOWED = new Set(["stats", "gas-tank", "channels", "claims", "events", "discovery", "supported", "health", "pq-ledger", "breaker"]);

/** Read-only proxy for dashboard data (so the browser only talks to this origin). */
export async function GET(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  if (!ALLOWED.has(path[0])) return new Response("not found", { status: 404 });
  const qs = new URL(req.url).search;
  try {
    const r = await fetch(`${FACILITATOR_URL}/${path.join("/")}${qs}`, { cache: "no-store" });
    return new Response(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
  } catch {
    return new Response(JSON.stringify({ error: "facilitator unreachable" }), { status: 502, headers: { "content-type": "application/json" } });
  }
}
