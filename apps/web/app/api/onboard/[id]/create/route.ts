import { getAddress, isAddress, keccak256, type Hex } from "viem";
import { leashVaultAbi } from "@leash/sdk";
import { consumeAttempt, getAttempt } from "@/lib/server/db";
import { publicClient, relay } from "@/lib/server/attestor";
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
    // The vault address comes from (owner key, World ID). If this key + World ID already made a vault, creating it
    // again can only revert (FailedDeployment): open the existing one instead. Opening is read-only; every change
    // still needs the owner's own key, so this grants nothing.
    if (at.vault && isAddress(at.vault)) {
      const vault = getAddress(at.vault);
      const code = await publicClient.getCode({ address: vault }).catch(() => undefined);
      if (code && code !== "0x") {
        const onchainKey = (await publicClient.readContract({ address: vault, abi: leashVaultAbi, functionName: "pqPubKeyHash" }).catch(() => undefined)) as Hex | undefined;
        if (onchainKey?.toLowerCase() === c.pqPubKeyHash.toLowerCase()) return ok({ vault, existing: true, worldSubjectHash: at.subject_hash, mocked: at.mode === "mock" });
        return err("A vault already exists at this address with a different owner key. Open it from Settings, or set up from a private window.", 409);
      }
    }
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
