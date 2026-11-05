import { getAddress, type Hex } from "viem";
import { leashVaultAbi } from "@leash/sdk";
import { publicClient, relay } from "@/lib/server/attestor";
import { err, handle, ok } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Submit a TIGHTENING change (revoke, lower limits, remove merchant): PQ signature only, no World check. */
export async function POST(req: Request) {
  return handle(async () => {
    const b = (await req.json()) as { vault: string; change: { action: number; data: Hex; nonce: string; deadline: string }; pqPubKey: Hex; pqSig: Hex };
    const vault = getAddress(b.vault);
    const loosening = await publicClient.readContract({ address: vault, abi: leashVaultAbi, functionName: "isLoosening", args: [b.change.action, b.change.data] });
    if (loosening) return err("loosening changes need a World ID approval (use the approvals flow)", 409);
    return ok(await relay("/relay/applyChange", { vault, change: b.change, pqPubKey: b.pqPubKey, pqSig: b.pqSig, wa: null, attestorSig: "0x" }));
  });
}
