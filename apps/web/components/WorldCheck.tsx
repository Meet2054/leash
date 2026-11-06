"use client";
import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { CheckCircle2, ExternalLink, Hourglass, Loader2, RotateCcw, XCircle } from "lucide-react";
import { api } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Pill } from "./leash/kit";

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
  effects?: unknown[] | null;
  serverDecoded?: string[] | null;
};

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** Shows the World ID request and polls the backend until the human finishes (or doesn't). */
export function WorldCheck({ attemptId, onDone, onRetry }: { attemptId: string; onDone: (a: Attempt) => void; onRetry?: () => void }) {
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

  if (!a)
    return (
      <div className="well flex items-center gap-2 p-4 text-[0.85rem] text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Preparing your World ID request…
      </div>
    );
  const mocked = a.mode === "mock";

  if (a.status === "COOLDOWN")
    return (
      <div className="well space-y-1.5 p-4">
        <div className="flex items-center gap-2 text-[0.9rem] font-medium">
          <Hourglass className="size-4 text-[var(--warn)]" /> Verified. Safety wait: {mmss(left)}
        </div>
        <p className="text-[0.8rem] leading-relaxed text-muted-foreground">Large withdrawals wait a few minutes before they can be signed. Press Deny, or freeze your agent, to cancel it.</p>
      </div>
    );

  if (a.status !== "PENDING") {
    const ok = a.status === "APPROVED";
    return (
      <div className="well flex items-start gap-3 p-4">
        {ok ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-[var(--ok)]" /> : <XCircle className="mt-0.5 size-5 shrink-0 text-[var(--bad)]" />}
        <div className="min-w-0 space-y-1">
          <div className="text-[0.9rem] font-medium">{ok ? "You're verified" : a.status === "EXPIRED" ? "The request expired" : "Not verified"}</div>
          <div className="text-[0.8rem] text-muted-foreground">{ok ? "World ID confirmed it's you, for this exact change." : `${a.reason ?? ""}. Nothing was signed.`}</div>
          {!ok && onRetry && (
            <Button variant="secondary" size="sm" className="mt-1" onClick={onRetry}>
              <RotateCcw /> Try again
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="well space-y-4 p-4">
      <div className="flex items-center justify-between">
        <div className="text-[0.9rem] font-medium">Verify with World ID</div>
        {mocked ? <Pill tone="warn">MOCKED issuer</Pill> : <Pill>{mmss(left)} left</Pill>}
      </div>
      <ol className="space-y-2 text-[0.84rem] leading-relaxed text-muted-foreground">
        <li>
          <span className="text-foreground">1.</span> Tap <span className="text-foreground">Open World ID</span> below, then <span className="text-foreground">Continue with World ID</span>.
        </li>
        <li>
          <span className="text-foreground">2.</span> {mocked ? "Approve on the mock page." : <>World shows a QR code. <span className="text-foreground">Scan it with the World ID app</span> on the phone that holds the World ID, and approve. If the app is on this phone, tap <span className="text-foreground">Open World ID app</span> instead.</>}
        </li>
        {!mocked && (
          <li>
            <span className="text-foreground">3.</span> Asked <span className="text-foreground">&ldquo;Are you a returning user?&rdquo;</span> Choose <span className="text-foreground">No, create an account</span> the first time with that World ID, <span className="text-foreground">Yes</span> after that.
          </li>
        )}
      </ol>
      <Button size="lg" className="w-full" asChild>
        <a href={a.verificationUriComplete ?? "#"} target="_blank" rel="noreferrer">
          {mocked ? "Open mock World check" : "Open World ID"} <ExternalLink />
        </a>
      </Button>
      {a.verificationUriComplete && (
        <details className="text-[0.75rem] text-muted-foreground">
          <summary className="cursor-pointer hover:text-foreground">Continue on another phone instead</summary>
          <div className="mt-2 flex items-center gap-3">
            <div className="shrink-0 rounded-xl bg-white p-2">
              <QRCodeSVG value={a.verificationUriComplete} size={112} />
            </div>
            <span>Scan with that phone&apos;s camera (not the World ID app). It opens this same request there; this page finishes by itself.</span>
          </div>
        </details>
      )}
      <div className="flex items-center justify-center gap-2 text-[0.75rem] text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Waiting for your approval…
      </div>
      {mocked && <p className="text-[0.72rem] text-muted-foreground">Offline demo mode: a local issuer stands in for World ID and is validated exactly like World&apos;s.</p>}
    </div>
  );
}
