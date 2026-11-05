import { getApproval } from "@/lib/server/db";
import { advanceAttempt } from "@/lib/server/attestor";
import { err, ok } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let a = getApproval(id);
  if (!a) return err("not found", 404);
  // keep the World attempt moving even if only the agent is polling
  if (a.attempt_id && a.status === "APPROVING") {
    await advanceAttempt(a.attempt_id).catch(() => undefined);
    a = getApproval(id)!;
  }
  return ok({ id: a.id, status: a.status, reason: a.status_reason ?? undefined, txHash: a.tx ?? undefined });
}
