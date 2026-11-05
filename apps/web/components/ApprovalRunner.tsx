"use client";
import { useState } from "react";
import { getAddress, type Hex } from "viem";
import { mandateChangeDigest } from "@leash/sdk";
import { api, explorerTx } from "@/lib/client/api";
import type { OwnerSigner } from "@/lib/client/signer";
import { WorldCheck, type Attempt } from "./WorldCheck";

type Step = "idle" | "world" | "signing" | "submitting" | "done" | "failed";

/**
 * Approve a loosening change: 1) fresh World ID check bound to this change → attestor signs WorldApproval
 * server-side, 2) the owner's Falcon key signs the change (digest recomputed here, not trusted), 3) relayed.
 */
export function ApprovalRunner({ approvalId, vault, chainId, signer, onDone }: { approvalId: string; vault: string; chainId: number; signer: OwnerSigner | null; onDone?: () => void }) {
  const [step, setStep] = useState<Step>("idle");
  const [attemptId, setAttemptId] = useState<string>();
  const [msg, setMsg] = useState<string>();
  const [tx, setTx] = useState<string>();

  const start = async () => {
    setMsg(undefined);
    if (!signer) return setMsg("Connect the owner key first (Onboard tab).");
    try {
      const s = await api<{ attemptId: string }>(`/api/approvals/${approvalId}/start`, {});
      setAttemptId(s.attemptId);
      setStep("world");
    } catch (e) {
      setStep("failed");
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const afterWorld = async (a: Attempt) => {
    if (a.status !== "APPROVED" || !a.change) {
      setStep("failed");
      setMsg(`World check ${a.status.toLowerCase()} — the agent stays capped.`);
      onDone?.();
      return;
    }
    try {
      setStep("signing");
      const change = { action: a.change.action, data: a.change.data, nonce: BigInt(a.change.nonce), deadline: BigInt(a.change.deadline) };
      const digest = mandateChangeDigest(chainId, getAddress(vault), change);
      if (digest.toLowerCase() !== a.changeHash?.toLowerCase()) throw new Error("server change hash mismatch — refusing to sign");
      const pqSig = await signer!.sign(digest, `MandateChange #${a.change.nonce}`);
      setStep("submitting");
      const r = await api<{ txHash: Hex }>(`/api/approvals/${approvalId}/submit`, { pqPubKey: await signer!.pubKey(), pqSig });
      setTx(r.txHash);
      setStep("done");
    } catch (e) {
      setStep("failed");
      setMsg(e instanceof Error ? e.message : String(e));
    }
    onDone?.();
  };

  return (
    <div className="space-y-2">
      {step === "idle" && (
        <button className="btn btn-primary" onClick={start}>
          Approve with World ID
        </button>
      )}
      {step === "world" && attemptId && <WorldCheck attemptId={attemptId} onDone={afterWorld} />}
      {step === "signing" && <div className="text-sm">Signing with your post-quantum (Falcon) key…</div>}
      {step === "submitting" && <div className="text-sm">Relaying (you pay no gas)…</div>}
      {step === "done" && tx && (
        <div className="text-sm font-semibold text-[var(--color-ok)]">
          ✓ Mandate loosened onchain —{" "}
          <a className="underline" href={explorerTx(tx)} target="_blank" rel="noreferrer">
            view tx
          </a>
        </div>
      )}
      {msg && <div className="text-sm text-[var(--color-bad)]">{msg}</div>}
    </div>
  );
}
