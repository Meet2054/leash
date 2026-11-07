import { FACILITATOR_URL } from "@/lib/server/env";

export const dynamic = "force-dynamic";

/** Testnet demo faucet (proxied to the facilitator, which holds the relayer key). */
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const r = await fetch(`${FACILITATOR_URL}/demo/faucet`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ vault: b.vault, ...(b.amount !== undefined ? { amount: String(b.amount) } : {}) }) });
  return new Response(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}
