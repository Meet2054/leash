import { getAddress, isAddress, verifyMessage, type Hex } from "viem";
import { describeOp, formatUnits6, leashVaultAbi, looseningRequestMessage, type Op } from "@leash/sdk";
import { insertApproval, listApprovals, newId, now } from "@/lib/server/db";
import { audit, publicClient } from "@/lib/server/attestor";
import { err, handle, ok } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const view = (a: ReturnType<typeof listApprovals>[number]) => ({
  id: a.id,
  source: a.source,
  vault: a.vault,
  session: a.session,
  action: a.action,
  data: a.data,
  description: describeOp({ action: a.action, data: a.data as Hex }, (x) => `${formatUnits6(x)} USDT`),
  reason: a.reason,
  status: a.status,
  statusReason: a.status_reason,
  createdAt: a.created_at,
  decidedAt: a.decided_at,
  txHash: a.tx,
  attemptId: a.attempt_id,
});

export async function GET(req: Request) {
  const vault = new URL(req.url).searchParams.get("vault") ?? undefined;
  return ok(listApprovals(vault).map(view));
}

/**
 * File a loosening request. Agents sign it with their session key (they can ASK, never approve).
 * The owner app may also file one for its own loosening edits (source = "owner").
 */
export async function POST(req: Request) {
  return handle(async () => {
    const b = await req.json();
    if (!isAddress(b.vault)) return err("bad vault");
    const op: Op = { action: Number(b.op?.action), data: b.op?.data };
    if (!Number.isInteger(op.action) || typeof op.data !== "string") return err("bad op");
    const vault = getAddress(b.vault);
    let source: "agent" | "owner" = "owner";
    let session: string | null = null;
    if (b.session) {
      source = "agent";
      session = getAddress(b.session);
      if (Math.abs(now() - Number(b.createdAt)) > 600) return err("stale request");
      const msg = looseningRequestMessage({ vault, session: session as Hex, op, reason: String(b.reason ?? ""), createdAt: Number(b.createdAt) });
      if (!(await verifyMessage({ address: session as Hex, message: msg, signature: b.sig }))) return err("bad session signature", 401);
      const [expiry] = await publicClient.readContract({ address: vault, abi: leashVaultAbi, functionName: "sessions", args: [session as Hex] });
      if (expiry === 0n) return err("not a session of this vault", 403);
    }
    const loosening = await publicClient.readContract({ address: vault, abi: leashVaultAbi, functionName: "isLoosening", args: [op.action, op.data] });
    if (!loosening) return err("not a loosening change — tighten directly with the owner key");
    const id = newId();
    insertApproval({ id, source, vault, session, action: op.action, data: op.data, reason: String(b.reason ?? "").slice(0, 500), request_sig: b.sig ?? null, status: "PENDING", created_at: now() });
    await audit("ApprovalRequested", vault, { approvalId: id, source, session, action: op.action });
    return ok({ id, status: "PENDING" });
  });
}
