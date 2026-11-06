"use client";
import { useState } from "react";
import { getAddress, type Hex } from "viem";
import { canonicalChange, mandateChangeDigest } from "@leash/sdk";
import { api, explorerTx } from "@/lib/client/api";
import type { OwnerSigner } from "@/lib/client/signer";
import { WorldCheck, type Attempt } from "./WorldCheck";
import { DecodePanel, decodingsMatch } from "./DecodePanel";

type WireChange = { action: number; data: Hex; nonce: string; deadline: string };
const toMsg = (c: WireChange) => ({ action: c.action, data: c.data, nonce: BigInt(c.nonce), deadline: BigInt(c.deadline) });

type Step = "idle" | "world" | "signing" | "submitting" | "done" | "failed";

/**
 * Approve a loosening change: 0) the attestor's decoding and this device's decoding of the exact bytes are
 * shown side by side (F8.2; mismatch = block), 1) fresh World ID check bound to this change → attestor signs
 * WorldApproval server-side, 2) the owner's Falcon key signs the change (digest recomputed here, not
 * trusted, and byte-identical to what was reviewed), 3) relayed.
 */
export function ApprovalRunner({ approvalId, vault, chainId, signer, onDone }: { approvalId: string; vault: string; chainId: number; signer: OwnerSigner | null; onDone?: () => void }) {
  const [step, setStep] = useState<Step>("idle");
  const [attemptId, setAttemptId] = useState<string>();
  const [msg, setMsg] = useState<string>();
  const [tx, setTx] = useState<string>();
  const [review, setReview] = useState<{ server: string[] | null; local: string[]; changeHash: string }>();

  const start = async () => {
    setMsg(undefined);
    if (!signer) return setMsg("Connect the owner key first (Onboard tab).");
    try {
      await signer.unlock?.(); // F8.3: passkey prompt while we still have the click's user activation
      const s = await api<{ attemptId: string; change: WireChange; changeHash: string; serverDecoded?: string[] }>(`/api/approvals/${approvalId}/start`, {});
      const change = toMsg(s.change);
      const local = canonicalChange(chainId, getAddress(vault), change);
      setReview({ server: s.serverDecoded ?? null, local, changeHash: s.changeHash });
      if (mandateChangeDigest(chainId, getAddress(vault), change).toLowerCase() !== s.changeHash.toLowerCase() || !decodingsMatch(s.serverDecoded, local)) {
        await api(`/api/approvals/${approvalId}/deny`, {}).catch(() => undefined);
        setStep("failed");
        setMsg("The attestor's decoding and this device's decoding differ. Refusing to continue (nothing signed).");
        onDone?.();
        return;
      }
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
      const change = toMsg(a.change);
      const digest = mandateChangeDigest(chainId, getAddress(vault), change);
      if (digest.toLowerCase() !== a.changeHash?.toLowerCase()) throw new Error("server change hash mismatch — refusing to sign");
      // F8.2: sign only the exact change the owner reviewed, and only if both decoders still agree on it
      if (digest.toLowerCase() !== review?.changeHash.toLowerCase()) throw new Error("the change differs from the one you reviewed — refusing to sign");
      if (!decodingsMatch(a.serverDecoded, canonicalChange(chainId, getAddress(vault), change))) throw new Error("decoding mismatch — refusing to sign");
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
      {review && step !== "idle" && <DecodePanel server={review.server} local={review.local} />}
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
