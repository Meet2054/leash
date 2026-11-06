import { completeFromCallback } from "@/lib/server/attestor";

export const dynamic = "force-dynamic";

const esc = (x: string) => x.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const page = (title: string, body: string, ok: boolean) =>
  new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Leash · World ID</title>
<style>body{font-family:Geist,ui-sans-serif,system-ui,sans-serif;background:#f3f4f7;color:#111111;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}
.c{max-width:420px;background:#ffffff;border-radius:22px;padding:24px;box-shadow:0 10px 30px rgba(5,26,115,.14)}h1{font-size:22px;letter-spacing:-.02em;color:${ok ? "#096c37" : "#930328"}}p{color:#5b6070;line-height:1.5}a{color:#0643d2}</style></head>
<body><div class="c"><h1>${esc(title)}</h1><p>${esc(body)}</p><p><a href="/">Back to Leash</a></p></div></body></html>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );

/**
 * World IdP redirect target (authorization code flow). Must match the callback registered in the World
 * portal exactly (WORLD_REDIRECT_URI). The browser only carries the one-time code; the server exchanges
 * it and validates the ID token. Nothing on this page is trusted as authorization by itself.
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const q = { state: u.searchParams.get("state"), code: u.searchParams.get("code"), error: u.searchParams.get("error"), errorDescription: u.searchParams.get("error_description") };
  console.log(`[world] callback hit with params: ${[...u.searchParams.keys()].join(", ") || "(none)"}`);
  try {
    const r = await completeFromCallback(q);
    if ("unknown" in r) return page("No matching approval", "This callback doesn't belong to an open Leash World check (it may have expired). Start the approval again from the app.", false);
    if (r.status === "APPROVED") return page("✓ World ID verified", "The attestor validated your World ID for this exact change. Return to the Leash app or terminal; it continues automatically.", true);
    if (r.status === "COOLDOWN") return page("✓ World ID verified · cooldown", "Large withdrawal: the attestor signs after the cooldown. You can close this tab.", true);
    return page(`✕ ${r.status}`, `${r.status_reason ?? "World check not completed"}. Nothing was signed.`, false);
  } catch (e) {
    return page("✕ Error", e instanceof Error ? e.message : String(e), false);
  }
}
