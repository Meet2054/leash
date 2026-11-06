"use client";
/**
 * The World ID request panel (Figma "World ID panel", Setup · 3 Verify — waiting): green-tinted card with a
 * countdown pill, numbered steps, the green "Open World ID" button, "Continue on another phone instead" and a
 * waiting spinner. Polls the backend until the human finishes (or doesn't). Also used by Requests.
 */
import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { CheckCircle2, ChevronDown, ChevronRight, Clock, ExternalLink, Hourglass, Loader2, RotateCcw, XCircle } from "lucide-react";
import { api } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Pill } from "./leash/kit";
import { cn } from "@/lib/utils";

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

/** Tinted panel shell (r16, hairline border). */
function Panel({ tint, className, children }: { tint: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("space-y-3.5 rounded-[16px] p-[18px] ring-1 ring-inset ring-[#222222]/12", className)} style={{ background: tint }}>
      {children}
    </div>
  );
}

const B = ({ children }: { children: React.ReactNode }) => <span className="font-semibold text-[#1f2230]">{children}</span>;

/** Shows the World ID request and polls the backend until the human finishes (or doesn't). */
export function WorldCheck({ attemptId, onDone, onRetry }: { attemptId: string; onDone: (a: Attempt) => void; onRetry?: () => void }) {
  const [a, setA] = useState<Attempt>();
  const [left, setLeft] = useState(0);
  const [otherPhone, setOtherPhone] = useState(false);
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
      <Panel tint="#f0fff1">
        <div className="flex items-center gap-2 text-[14px] text-addr">
          <Loader2 className="size-4 animate-spin text-green" /> Preparing your World ID request…
        </div>
      </Panel>
    );
  const mocked = a.mode === "mock";

  if (a.status === "COOLDOWN")
    return (
      <Panel tint="#fffdec">
        <div className="flex items-center gap-2 text-[16px] font-semibold text-[#1f2230]">
          <Hourglass className="size-[18px] text-amber" /> Verified. Safety wait: <span className="num font-mono text-amber">{mmss(left)}</span>
        </div>
        <p className="text-[14px] leading-5 text-[#4a4f5e]">Large withdrawals wait a few minutes before they can be signed. Press Deny, or freeze your agent, to cancel it.</p>
      </Panel>
    );

  if (a.status !== "PENDING") {
    const ok = a.status === "APPROVED";
    return (
      <Panel tint={ok ? "#f0fff1" : "#fff0f4"}>
        <div className="flex items-start gap-3">
          {ok ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-green" /> : <XCircle className="mt-0.5 size-5 shrink-0 text-red" />}
          <div className="min-w-0 space-y-1">
            <div className="text-[16px] font-semibold text-[#1f2230]">{ok ? "You're verified" : a.status === "EXPIRED" ? "The request expired" : "Not verified"}</div>
            <div className="text-[14px] leading-5 text-[#4a4f5e]">{ok ? "World ID confirmed it's you, for this exact change." : `${a.reason ?? ""}. Nothing was signed.`}</div>
            {!ok && onRetry && (
              <Button variant="secondary" size="sm" className="mt-2" onClick={onRetry}>
                <RotateCcw /> Try again
              </Button>
            )}
          </div>
        </div>
      </Panel>
    );
  }

  return (
    <Panel tint="#f0fff1">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[16px] font-semibold leading-[22px] tracking-[-0.005em] text-[#1f2230]">Verify with World ID</div>
        {mocked ? (
          <Pill tone="warn">MOCKED issuer</Pill>
        ) : (
          <span className="inline-flex h-[30px] items-center gap-1.5 rounded-full bg-white px-2.5 text-[14px] font-semibold text-green">
            <Clock className="size-[13px] stroke-[2.2]" />
            <span className="num">{mmss(left)} left</span>
          </span>
        )}
      </div>
      <ol className="space-y-2.5 text-[14px] leading-5 tracking-[-0.005em] text-[#1f2230]/80">
        <li>
          <B>1.</B> Tap <B>Open World ID</B> below, then <B>Continue with World ID</B>.
        </li>
        <li>
          <B>2.</B>{" "}
          {mocked ? (
            "Approve on the mock page."
          ) : (
            <>
              World shows a QR code. <B>Scan it with the World ID app</B> on the phone that holds the World ID, and approve. If the app is on this phone, tap <B>Open World ID app</B> instead.
            </>
          )}
        </li>
        {!mocked && (
          <li>
            <B>3.</B> Asked <B>&ldquo;Are you a returning user?&rdquo;</B> Choose <B>No, create an account</B> the first time with that World ID, <B>Yes</B> after that.
          </li>
        )}
      </ol>
      <Button variant="green" className="w-full" asChild>
        <a href={a.verificationUriComplete ?? "#"} target="_blank" rel="noreferrer">
          {mocked ? "Open mock World check" : "Open World ID"} <ExternalLink />
        </a>
      </Button>
      {a.verificationUriComplete && (
        <div>
          <button type="button" className="flex items-center gap-1.5 text-[14px] leading-5 text-green" onClick={() => setOtherPhone(!otherPhone)} aria-expanded={otherPhone}>
            {otherPhone ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />} Continue on another phone instead
          </button>
          {otherPhone && (
            <div className="mt-2.5 flex items-center gap-3 rounded-[14px] bg-white p-2.5">
              <div className="shrink-0 rounded-[10px] bg-white p-1">
                <QRCodeSVG value={a.verificationUriComplete} size={112} />
              </div>
              <span className="text-[13px] leading-[18px] text-[#4a4f5e]">Scan with that phone&apos;s camera (not the World ID app). It opens this same request there; this page finishes by itself.</span>
            </div>
          )}
        </div>
      )}
      <div className="flex items-center justify-center gap-2 text-[14px] leading-5 text-addr">
        <Loader2 className="size-4 animate-spin" /> Waiting for your approval…
      </div>
      {mocked && <p className="text-[12px] leading-4 text-addr">Offline demo mode: a local issuer stands in for World ID and is validated exactly like World&apos;s.</p>}
    </Panel>
  );
}
