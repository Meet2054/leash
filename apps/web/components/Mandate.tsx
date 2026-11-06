"use client";
/**
 * Mandate operations for the owner app: the vault view, the circuit breaker, and `submit`, which signs a change.
 * Tightening (revoke, lower caps, remove merchants) → the owner's post-quantum key only.
 * Loosening (add agent, raise caps, allow merchants, withdraw) → filed as an approval that needs World ID too.
 */
import { useState } from "react";
import { getAddress, type Hex } from "viem";
import { toast } from "sonner";
import { mandateChangeDigest, type Op } from "@leash/sdk";
import { api, explorerTx, usePoll } from "@/lib/client/api";
import type { OwnerSigner } from "@/lib/client/signer";

export type VaultState = {
  vault: string;
  deployed: boolean;
  balance: string;
  free?: string;
  locked?: string;
  nonce?: string;
  worldSubjectHash?: string;
  pqPubKeyHash?: string;
  verifier?: string;
  sessions?: { address: string; expiry: string; revoked: boolean; cap: string; locked: string; spent: string }[];
  merchants?: { address: string; allowed: boolean; dailyCap: string; spentToday: string; maxChannel: string }[];
};
export type Session = NonNullable<VaultState["sessions"]>[number];
export type Breaker = { enabled?: boolean; state?: string; reason?: string; detail?: string; sessionsSeen?: string[]; reopensAt?: number };

/** A channel reserves 1 USDT, so a renewed agent needs a cap of at least ~2 USDT (still ≤ 2× per the safety policy). */
export const renewCap = (cap: bigint) => (cap >= 2_000_000n ? cap : cap * 2n >= 2_000_000n ? 2_000_000n : cap * 2n);

export type SubmitResult = "done" | "approval" | "error";

export function useMandate(vault: string, chainId: number, signer: OwnerSigner | null) {
  const { data: v, refresh } = usePoll<VaultState>(`/api/vault/${vault}`, 5000);
  const { data: breaker } = usePoll<Breaker>(`/api/facilitator/breaker?vault=${vault}`, 3000);
  const [busy, setBusy] = useState<string>();
  const [pendingApproval, setPendingApproval] = useState<string>();

  const submit = async (op: Op, label: string): Promise<SubmitResult> => {
    if (!signer) {
      toast.error("Your owner key isn't connected. Open Settings → Re-run setup.");
      return "error";
    }
    try {
      await signer.unlock?.();
      setBusy(label);
      const p = await api<{ change: { action: number; data: Hex; nonce: string; deadline: string }; digest: Hex; loosening: boolean }>("/api/changes/prepare", { vault, action: op.action, data: op.data });
      if (p.loosening) {
        const r = await api<{ id: string }>("/api/approvals", { vault, op, reason: `Owner edit: ${label}` });
        setPendingApproval(r.id);
        toast("This loosens a limit, so it needs World ID. Confirm it now.");
        return "approval";
      }
      const change = { action: p.change.action, data: p.change.data, nonce: BigInt(p.change.nonce), deadline: BigInt(p.change.deadline) };
      const digest = mandateChangeDigest(chainId, getAddress(vault), change);
      if (digest !== p.digest) throw new Error("digest mismatch");
      const pqSig = await signer.sign(digest, label);
      const r = await api<{ txHash: string }>("/api/changes/submit", { vault, change: p.change, pqPubKey: await signer.pubKey(), pqSig });
      toast.success(`${label}: done`, { action: { label: "View", onClick: () => window.open(explorerTx(r.txHash), "_blank") } });
      refresh();
      return "done";
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      return "error";
    } finally {
      setBusy(undefined);
    }
  };

  return { v, refresh, breaker, busy, pendingApproval, setPendingApproval, submit };
}
export type MandateOps = ReturnType<typeof useMandate>;
