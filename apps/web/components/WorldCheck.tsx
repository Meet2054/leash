"use client";
import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { api } from "@/lib/client/api";

export type Attempt = {
  attemptId: string;
  kind: "approval" | "create";
  mode: "world" | "mock";
  status: "PENDING" | "COOLDOWN" | "APPROVED" | "DENIED" | "EXPIRED" | "ERROR";
  reason: string | null;
  userCode: string | null;
  verificationUri: string | null;
  verificationUriComplete: string | null;
  expiresAt: number;
  vault: string | null;
  changeHash: string | null;
  change: { action: number; data: `0x${string}`; nonce: string; deadline: string } | null;
  initConfig: { pqPubKeyHash: `0x${string}`; worldSubjectHash: `0x${string}`; verifier: `0x${string}`; initialMandate: `0x${string}` } | null;
  authTime: number | null;
  cooldownUntil?: number | null;
  serverDecoded?: string[] | null;
  effects?: unknown[] | null;
};

/** Shows the World ID Agent Pass request and polls the backend until the human finishes (or doesn't). */
export function WorldCheck({ attemptId, onDone }: { attemptId: string; onDone: (a: Attempt) => void }) {
  const [a, setA] = useState<Attempt>();
  const [left, setLeft] = useState(0);
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const x = await api<Attempt>(`/api/world/attempts/${attemptId}`);
        if (stop) return;
        setA(x);
        if (x.status !== "PENDING" && x.status !== "COOLDOWN") return onDone(x);
      } catch {
        /* retry */
      }
      if (!stop) setTimeout(tick, 1500);
    };
    tick();
    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId]);
  useEffect(() => {
    const t = setInterval(() => a && setLeft(Math.max(0, (a.status === "COOLDOWN" ? a.cooldownUntil ?? 0 : a.expiresAt) - Math.floor(Date.now() / 1000))), 1000);
    return () => clearInterval(t);
  }, [a]);
  if (!a) return <div className="muted text-sm">Starting World ID check…</div>;
  const mocked = a.mode === "mock";
  return (
    <div className="soft rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="font-semibold">World ID Agent Pass</div>
        {mocked ? <span className="pill" style={{ color: "var(--color-warn)" }}>MOCKED issuer</span> : <span className="pill">World IdP</span>}
      </div>
      {a.status === "COOLDOWN" ? (
        <div className="text-sm space-y-1">
          <div className="font-semibold" style={{ color: "var(--color-warn)" }}>✓ World ID verified · cooldown {left}s before the attestor signs</div>
          <div className="muted">Large withdrawal: the attestor waits before signing (F8). Press Deny, or apply any post-quantum-signed change (e.g. Freeze all), to cancel it.</div>
        </div>
      ) : a.status === "PENDING" ? (
        <>
          <div className="flex gap-4 items-center">
            {a.verificationUriComplete && (
              <div className="bg-white p-2 rounded-lg shrink-0">
                <QRCodeSVG value={a.verificationUriComplete} size={128} />
              </div>
            )}
            <div className="space-y-2 text-sm min-w-0">
              <div>
                Code <span className="mono text-base font-bold">{a.userCode}</span>
              </div>
              <a className="btn btn-primary inline-block" href={a.verificationUriComplete ?? "#"} target="_blank" rel="noreferrer">
                {mocked ? "Open mock World check" : "Verify with World"}
              </a>
              <div className="muted">Waiting for you to verify… {left}s left</div>
            </div>
          </div>
          {mocked && <p className="text-xs muted">Offline demo mode: a local issuer stands in for World ID. The backend validates its ID token exactly like World&apos;s (signature, issuer, audience, fresh auth_time, proof of personhood).</p>}
        </>
      ) : (
        <div className={`text-sm font-semibold ${a.status === "APPROVED" ? "text-[var(--color-ok)]" : "text-[var(--color-bad)]"}`}>
          {a.status === "APPROVED" ? "✓ Verified — attestation issued for this exact change" : `✕ ${a.status}: ${a.reason ?? ""} — nothing was signed`}
        </div>
      )}
    </div>
  );
}
