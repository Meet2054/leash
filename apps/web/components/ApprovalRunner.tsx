"use client";
import { useState } from "react";
import { getAddress, type Hex } from "viem";
import { CheckCircle2, Loader2, ScanFace, XCircle } from "lucide-react";
import { toast } from "sonner";
import { canonicalChange, mandateChangeDigest } from "@leash/sdk";
import { api } from "@/lib/client/api";
import type { OwnerSigner } from "@/lib/client/signer";
import { Button } from "@/components/ui/button";
import { WorldCheck, type Attempt } from "./WorldCheck";
import { DecodePanel, decodingsMatch } from "./DecodePanel";
import { TxLink } from "./leash/kit";

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
    if (!signer) return toast.error("Your owner key isn't connected. Open Setup first.");
    try {
      await signer.unlock?.(); // F8.3: passkey prompt while we still have the click's user activation
      const s = await api<{ attemptId: string; change: WireChange; changeHash: string; serverDecoded?: string[] }>(`/api/approvals/${approvalId}/start`, {});
      const change = toMsg(s.change);
      const local = canonicalChange(chainId, getAddress(vault), change);
      setReview({ server: s.serverDecoded ?? null, local, changeHash: s.changeHash });
      if (mandateChangeDigest(chainId, getAddress(vault), change).toLowerCase() !== s.changeHash.toLowerCase() || !decodingsMatch(s.serverDecoded, local)) {
        await api(`/api/approvals/${approvalId}/deny`, {}).catch(() => undefined);
        setStep("failed");
        setMsg("The server and this device decoded the change differently. Nothing was signed.");
        onDone?.();
        return;
      }
      setAttemptId(s.attemptId);
      setStep("world");
    } catch (e) {
      setStep("failed");
      setMsg(e instanceof Error ? e.message.replace(/^blocked by attestor policy: /, "Blocked by the safety policy: ") : String(e));
      onDone?.();
    }
  };

  const afterWorld = async (a: Attempt) => {
    if (a.status !== "APPROVED" || !a.change) {
      setStep("failed");
      setMsg(a.status === "EXPIRED" ? "The World ID request expired. Nothing changed." : "World ID wasn't confirmed. Nothing changed; the agent stays capped.");
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
      toast.success("Approved and applied onchain");
    } catch (e) {
      setStep("failed");
      setMsg(e instanceof Error ? e.message : String(e));
    }
    onDone?.();
  };

  return (
    <div className="space-y-3">
      {review && step !== "idle" && <DecodePanel server={review.server} local={review.local} />}
      {step === "idle" && (
        <Button size="lg" className="w-full" onClick={start}>
          <ScanFace /> Approve with World ID
        </Button>
      )}
      {step === "world" && attemptId && <WorldCheck attemptId={attemptId} onDone={afterWorld} />}
      {(step === "signing" || step === "submitting") && (
        <div className="well flex items-center gap-2 p-4 text-[0.85rem]">
          <Loader2 className="size-4 animate-spin" /> {step === "signing" ? "Signing with your post-quantum key…" : "Applying onchain (we pay the gas)…"}
        </div>
      )}
      {step === "done" && tx && (
        <div className="well flex items-center justify-between gap-2 p-4">
          <div className="flex items-center gap-2 text-[0.88rem] font-medium">
            <CheckCircle2 className="size-5 text-[var(--ok)]" /> Limit updated onchain
          </div>
          <TxLink hash={tx} label="View" />
        </div>
      )}
      {step === "failed" && msg && (
        <div className="well flex items-start gap-2 p-4 text-[0.82rem]">
          <XCircle className="mt-0.5 size-4 shrink-0 text-[var(--bad)]" />
          <span>{msg}</span>
        </div>
      )}
    </div>
  );
}
