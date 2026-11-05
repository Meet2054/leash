import { getApproval, now, setApproval } from "@/lib/server/db";
import { audit } from "@/lib/server/attestor";
import { err, ok } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Owner denies: nothing is signed and nothing changes onchain. The agent stays capped. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = getApproval(id);
  if (!a) return err("not found", 404);
  if (a.status !== "PENDING" && a.status !== "APPROVING") return err(`already ${a.status}`);
  setApproval(id, { status: "DENIED", status_reason: "denied by the owner", decided_at: now() });
  await audit("ApprovalDenied", a.vault, { approvalId: id, reason: "denied by the owner" });
  return ok({ id, status: "DENIED" });
}
