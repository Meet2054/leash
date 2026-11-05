import { getAddress, type Hex } from "viem";
import { leashVaultAbi, mandateChangeDigest } from "@leash/sdk";
import { publicClient } from "@/lib/server/attestor";
import { CHAIN_ID } from "@/lib/server/env";
import { handle, ok } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Build a MandateChange at the vault's current nonce. Tightening ones can be signed and submitted directly. */
export async function POST(req: Request) {
  return handle(async () => {
    const b = (await req.json()) as { vault: string; action: number; data: Hex };
    const vault = getAddress(b.vault);
    const [nonce, loosening] = await Promise.all([
      publicClient.readContract({ address: vault, abi: leashVaultAbi, functionName: "mandateNonce" }),
      publicClient.readContract({ address: vault, abi: leashVaultAbi, functionName: "isLoosening", args: [b.action, b.data] }),
    ]);
    const change = { action: b.action, data: b.data, nonce, deadline: BigInt(Math.floor(Date.now() / 1000) + 600) };
    return ok({ change, digest: mandateChangeDigest(CHAIN_ID, vault, change), loosening });
  });
}
