import { demoAsk } from "@/lib/server/demo";
import { err, ok } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { vault?: string; kind?: "reasonable" | "injected" };
  if (!b.vault) return err("vault required");
  try {
    return ok(await demoAsk(b.vault, b.kind === "injected" ? "injected" : "reasonable", process.env.INTERNAL_URL ?? `http://127.0.0.1:${process.env.WEB_PORT ?? 3000}`));
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}
