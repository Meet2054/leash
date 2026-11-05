import { mockDecision, publicAttempt } from "@/lib/server/attestor";
import { WORLD } from "@/lib/server/env";
import { err, handle, ok } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** MOCKED World check (WORLD_MODE=mock only): approve or cancel from the local mock page. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (WORLD.mode !== "mock") return err("mock mode is disabled", 404);
  const { id } = await params;
  return handle(async () => {
    const { decision } = (await req.json()) as { decision: "approve" | "deny" };
    return ok(publicAttempt(await mockDecision(id, decision === "approve" ? "approve" : "deny")));
  });
}
