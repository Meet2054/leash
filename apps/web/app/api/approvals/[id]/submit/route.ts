import { type Hex } from "viem";
import { consumeAttempt, getApproval, getAttempt, now, setApproval } from "@/lib/server/db";
import { relay } from "@/lib/server/attestor";
import { err, handle, ok } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/**
 * After the World check passed, the owner's device sends its post-quantum signature over the change.
 * The server pairs it with the attestor's WorldApproval it holds (the client cannot swap either) and
 * relays it. Single use: the attempt is consumed atomically.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => {
    const b = (await req.json()) as { pqPubKey: Hex; pqSig: Hex };
    const a = getApproval(id);
    if (!a?.attempt_id) return err("no World check for this approval", 409);
    const at = getAttempt(a.attempt_id);
    if (!at || at.status !== "APPROVED") return err(`World check is ${at?.status ?? "missing"}`, 409);
    if (!consumeAttempt(at.id)) return err("this approval was already used", 409);
    const change = JSON.parse(at.change_json!);
    try {
      const r = await relay<{ txHash: Hex; explorerUrl: string; gasUsed: string }>("/relay/applyChange", {
        vault: at.vault,
        change,
        pqPubKey: b.pqPubKey,
        pqSig: b.pqSig,
        wa: JSON.parse(at.wa_json!),
        attestorSig: at.attestor_sig,
        approvalId: id,
      });
      setApproval(id, { status: "APPROVED", status_reason: at.mode === "mock" ? "approved (World check MOCKED)" : "approved with World ID", decided_at: now(), tx: r.txHash });
      return ok({ id, status: "APPROVED", ...r });
    } catch (e) {
      setApproval(id, { status: "FAILED", status_reason: e instanceof Error ? e.message.slice(0, 300) : String(e), decided_at: now() });
      throw e;
    }
  });
}
