import { runDemoAgent } from "@/lib/server/demo";
import { err, ok } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { vault?: string; calls?: number };
  if (!b.vault) return err("vault required");
  try {
    return ok(await runDemoAgent(b.vault, b.calls ?? 20));
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}
