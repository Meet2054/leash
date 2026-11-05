import { keccak256, type Hex } from "viem";
import { consumeAttempt, getAttempt } from "@/lib/server/db";
import { relay } from "@/lib/server/attestor";
import { err, handle, ok } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Create the vault: owner's PQ signature over InitConfig + the attestor's WorldApproval, relayed (no gas). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => {
    const b = (await req.json()) as { pqPubKey: Hex; pqSig: Hex };
    const at = getAttempt(id);
    if (!at || at.kind !== "create" || at.status !== "APPROVED") return err(`World check is ${at?.status ?? "missing"}`, 409);
    const c = JSON.parse(at.change_json!) as { pqPubKeyHash: Hex; initialMandate: Hex; verifier: Hex };
    if (keccak256(b.pqPubKey).toLowerCase() !== c.pqPubKeyHash.toLowerCase()) return err("public key does not match the one bound to this World check");
    if (!consumeAttempt(id)) return err("this World check was already used", 409);
    const cfg = { pqPubKeyHash: c.pqPubKeyHash, worldSubjectHash: at.subject_hash, verifier: c.verifier, initialMandate: c.initialMandate };
    const r = await relay<{ vault: Hex; txHash: Hex; explorerUrl: string; gasUsed: string }>("/relay/createVault", {
      cfg,
      pqPubKey: b.pqPubKey,
      pqSig: b.pqSig,
      wa: JSON.parse(at.wa_json!),
      attestorSig: at.attestor_sig,
    });
    return ok({ ...r, worldSubjectHash: at.subject_hash, mocked: at.mode === "mock" });
  });
}
