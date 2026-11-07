"use client";
/**
 * "Add USDT" sheet: top the vault up with any amount.
 *  1. Testnet: the demo faucet sends that much test USDT now (limits: 5 per request, 10 a day per vault).
 *  2. Any wallet or exchange: a payment QR (EIP-681, USDT transfer to the vault with the amount filled in),
 *     plus the address to copy. The owner never needs gas for this; the vault address is all a sender needs.
 */
import { useState } from "react";
import { ArrowUpRight, Loader2, Plus, QrCode } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Copyable, Field, Sheet } from "@/components/leash/kit";
import { cn } from "@/lib/utils";

const USDT = "0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7";
const CHIPS = ["1", "2", "5"];

export function AddFunds({ open, onOpenChange, vault, chainId, onAdded }: { open: boolean; onOpenChange: (o: boolean) => void; vault: string; chainId: number; onAdded?: () => void }) {
  const [amount, setAmount] = useState("2");
  const [busy, setBusy] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const n = Number(amount);
  const valid = Number.isFinite(n) && n >= 0.1 && n <= 5;
  const atomic = valid ? BigInt(Math.round(n * 1e6)) : 0n;
  const payUri = `ethereum:${USDT}@${chainId}/transfer?address=${vault}&uint256=${atomic}`;

  const topUp = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/demo/faucet", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ vault, amount }) });
      const j = (await r.json().catch(() => ({}))) as { tx?: string; explorerUrl?: string; message?: string; error?: string; leftToday?: string };
      if (!r.ok || !j.tx) throw new Error(j.message ?? j.error ?? `HTTP ${r.status}`);
      toast.success(`Added ${amount} USDT to your vault`, {
        description: j.leftToday !== undefined ? `You can add ${Number(j.leftToday) / 1e6} more today.` : undefined,
        action: j.explorerUrl ? { label: "View", onClick: () => window.open(j.explorerUrl, "_blank", "noreferrer") } : undefined,
      });
      onAdded?.();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Add USDT" icon={<Plus />} hue="blue" description="Choose how much to add to your vault. Your agent can only spend it within the limits you set.">
      <Field label="Amount (USDT)">
        <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(",", "."))} placeholder="2" />
      </Field>
      <div className="flex gap-2">
        {CHIPS.map((c) => (
          <button key={c} type="button" onClick={() => setAmount(c)} className={cn("h-9 flex-1 rounded-full text-[14px] font-semibold transition-colors", amount === c ? "bg-blue text-white" : "bg-blue-bg text-blue hover:bg-[#e2eafd]")}>
            {c} USDT
          </button>
        ))}
      </div>
      {!valid && amount !== "" && <div className="text-[13px] text-red">Pick between 0.1 and 5 USDT.</div>}

      <Button className="w-full" disabled={!valid || busy} onClick={topUp}>
        {busy ? <Loader2 className="animate-spin" /> : <Plus />} {busy ? "Adding…" : `Add ${valid ? amount : ""} test USDT now`}
      </Button>
      <p className="-mt-1 text-center text-[13px] leading-[18px] text-body">Free test money on Whitechain testnet. Up to 5 USDT at a time, 10 a day per vault. Leash pays the network fee.</p>

      <div className="flex items-center gap-3 py-1 text-[13px] text-muted-ink">
        <span className="h-px flex-1 bg-line" /> or send from any wallet <span className="h-px flex-1 bg-line" />
      </div>

      <div className="space-y-3 rounded-[16px] bg-surface p-4">
        <div className="text-[14px] leading-5 text-body">
          Send <b className="font-semibold text-ink">USDT on Whitechain</b> (chain {chainId}) to your vault address. No gas or setup needed on your side beyond the transfer itself.
        </div>
        <Copyable value={vault} display={vault} className="w-full justify-between bg-white text-[12px]" />
        <button type="button" onClick={() => setShowQr((s) => !s)} className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-blue">
          <QrCode className="size-4" /> {showQr ? "Hide QR code" : `Show a QR for ${valid ? amount : "this"} USDT`}
        </button>
        {showQr && valid && (
          <div className="flex flex-col items-center gap-2 rounded-[14px] bg-white p-4">
            <QRCodeSVG value={payUri} size={168} />
            <div className="text-center text-[12px] text-body">Scan with a wallet app: it fills in USDT, the amount and your vault.</div>
          </div>
        )}
        <a className="inline-flex items-center gap-1 text-[13px] text-body hover:text-ink" href={`https://explorer.testnet.whitechain.io/address/${vault}`} target="_blank" rel="noreferrer">
          Check the balance on the explorer <ArrowUpRight className="size-3.5" />
        </a>
      </div>
    </Sheet>
  );
}
