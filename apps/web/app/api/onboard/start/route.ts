import { isHex, type Hex } from "viem";
import { startCreateAttempt } from "@/lib/server/attestor";
import { err, handle, ok } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Onboarding: link World ID. The World login fixes worldSubjectHash, and with it the vault address. */
export async function POST(req: Request) {
  return handle(async () => {
    const b = (await req.json()) as { pqPubKeyHash: Hex; initialMandate: Hex };
    if (!isHex(b.pqPubKeyHash) || b.pqPubKeyHash.length !== 66 || !isHex(b.initialMandate)) return err("bad input");
    return ok(await startCreateAttempt(b));
  });
}
