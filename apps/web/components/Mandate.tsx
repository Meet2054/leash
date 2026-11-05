"use client";
import { useState } from "react";
import { getAddress, isAddress, type Hex } from "viem";
import { encode, mandateChangeDigest, parseUnits6, type Op } from "@leash/sdk";
import { api, explorerAddr, explorerTx, short, usePoll, usdt } from "@/lib/client/api";
import type { OwnerSigner } from "@/lib/client/signer";
import { ApprovalRunner } from "./ApprovalRunner";

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

export function Mandate({ vault, chainId, signer }: { vault: string; chainId: number; signer: OwnerSigner | null }) {
  const { data: v, refresh } = usePoll<VaultState>(`/api/vault/${vault}`, 5000);
  const [busy, setBusy] = useState<string>();
  const [msg, setMsg] = useState<{ ok: boolean; text: string; tx?: string }>();
  const [pendingApproval, setPendingApproval] = useState<string>();
  const [form, setForm] = useState({ session: "", cap: "5", hours: "24", merchant: "", daily: "10", max: "1", withdrawTo: "", withdrawAmt: "1" });

  /** Tightening → PQ signature only. Loosening → owner approval with World ID. */
  const submit = async (op: Op, label: string) => {
    setMsg(undefined);
    if (!signer) return setMsg({ ok: false, text: "Owner key not connected." });
    try {
      setBusy(`Preparing: ${label}`);
      const p = await api<{ change: { action: number; data: Hex; nonce: string; deadline: string }; digest: Hex; loosening: boolean }>("/api/changes/prepare", { vault, action: op.action, data: op.data });
      if (p.loosening) {
        const r = await api<{ id: string }>("/api/approvals", { vault, op, reason: `Owner edit: ${label}` });
        setPendingApproval(r.id);
        setBusy(undefined);
        return;
      }
      const change = { action: p.change.action, data: p.change.data, nonce: BigInt(p.change.nonce), deadline: BigInt(p.change.deadline) };
      const digest = mandateChangeDigest(chainId, getAddress(vault), change);
      if (digest !== p.digest) throw new Error("digest mismatch");
      setBusy("Signing with your Falcon key (tightening: no World check needed)…");
      const pqSig = await signer.sign(digest, label);
      setBusy("Relaying…");
      const r = await api<{ txHash: string }>("/api/changes/submit", { vault, change: p.change, pqPubKey: await signer.pubKey(), pqSig });
      setMsg({ ok: true, text: `${label} — done`, tx: r.txHash });
      refresh();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(undefined);
    }
  };

  if (!v) return <div className="card muted">Loading vault…</div>;
  if (!v.deployed) return <div className="card">Vault not deployed yet. Balance waiting: {usdt(v.balance)} USDT</div>;
  const now = Date.now() / 1000;

  return (
    <div className="space-y-4">
      <section className="card grid grid-cols-3 gap-2 text-center">
        <div><div className="text-xl font-bold">{usdt(v.balance)}</div><div className="text-xs muted">USDT in vault</div></div>
        <div><div className="text-xl font-bold">{usdt(v.free)}</div><div className="text-xs muted">free</div></div>
        <div><div className="text-xl font-bold">{usdt(v.locked)}</div><div className="text-xs muted">locked in channels</div></div>
        <div className="col-span-3 text-xs muted">
          <a className="mono underline" href={explorerAddr(vault)} target="_blank" rel="noreferrer">{vault}</a> · mandate nonce {v.nonce}
        </div>
      </section>

      <section className="card space-y-2">
        <h2 className="font-semibold">Agent sessions</h2>
        {v.sessions?.map((s) => {
          const live = !s.revoked && Number(s.expiry) > now;
          return (
            <div key={s.address} className="soft rounded-xl p-3 text-sm space-y-1">
              <div className="flex justify-between items-center">
                <span className="mono">{short(s.address)}</span>
                <span className="pill" style={{ color: live ? "var(--color-ok)" : "var(--color-bad)" }}>{s.revoked ? "revoked" : live ? "active" : "expired"}</span>
              </div>
              <div>
                cap <b>{usdt(s.cap)}</b> · spent {usdt(s.spent)} · locked {usdt(s.locked)} · until {new Date(Number(s.expiry) * 1000).toLocaleString()}
              </div>
              {!s.revoked && (
                <div className="flex gap-2 flex-wrap">
                  <button className="btn btn-danger" disabled={!!busy} onClick={() => submit(encode.revokeSession(getAddress(s.address)), `Revoke session ${short(s.address)}`)}>Revoke</button>
                  <input className="input w-24" value={form.cap} onChange={(e) => setForm({ ...form, cap: e.target.value })} />
                  <button className="btn" disabled={!!busy} onClick={() => submit(encode.setSessionLimits(getAddress(s.address), BigInt(s.expiry), parseUnits6(form.cap)), `Set session cap to ${form.cap} USDT`)}>Set cap</button>
                </div>
              )}
            </div>
          );
        })}
        <div className="grid grid-cols-3 gap-2 text-sm pt-2">
          <input className="input mono col-span-3" placeholder="new session address 0x…" value={form.session} onChange={(e) => setForm({ ...form, session: e.target.value })} />
          <input className="input" value={form.cap} onChange={(e) => setForm({ ...form, cap: e.target.value })} title="cap USDT" />
          <input className="input" value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} title="hours" />
          <button className="btn" disabled={!!busy || !isAddress(form.session)} onClick={() => submit(encode.addSession(getAddress(form.session), BigInt(Math.floor(now + Number(form.hours) * 3600)), parseUnits6(form.cap)), "Add session")}>Add session</button>
        </div>
      </section>

      <section className="card space-y-2">
        <h2 className="font-semibold">Allowed merchants</h2>
        {v.merchants?.map((m) => (
          <div key={m.address} className="soft rounded-xl p-3 text-sm flex justify-between items-center gap-2 flex-wrap">
            <div>
              <span className="mono">{short(m.address)}</span>{" "}
              {m.allowed ? <span className="pill" style={{ color: "var(--color-ok)" }}>allowed</span> : <span className="pill">removed</span>}
              <div className="muted">daily {usdt(m.dailyCap)} (today {usdt(m.spentToday)}) · max/channel {usdt(m.maxChannel)}</div>
            </div>
            {m.allowed && <button className="btn btn-danger" disabled={!!busy} onClick={() => submit(encode.removeMerchant(getAddress(m.address)), `Remove merchant ${short(m.address)}`)}>Remove</button>}
          </div>
        ))}
        <div className="grid grid-cols-3 gap-2 text-sm pt-2">
          <input className="input mono col-span-3" placeholder="merchant address 0x…" value={form.merchant} onChange={(e) => setForm({ ...form, merchant: e.target.value })} />
          <input className="input" value={form.daily} onChange={(e) => setForm({ ...form, daily: e.target.value })} title="daily cap" />
          <input className="input" value={form.max} onChange={(e) => setForm({ ...form, max: e.target.value })} title="max per channel" />
          <button className="btn" disabled={!!busy || !isAddress(form.merchant)} onClick={() => submit(encode.setMerchant(getAddress(form.merchant), parseUnits6(form.daily), parseUnits6(form.max)), "Set merchant limits")}>Set limits</button>
        </div>
      </section>

      <section className="card space-y-2">
        <h2 className="font-semibold">Withdraw</h2>
        <div className="grid grid-cols-3 gap-2 text-sm">
          <input className="input mono col-span-2" placeholder="to 0x…" value={form.withdrawTo} onChange={(e) => setForm({ ...form, withdrawTo: e.target.value })} />
          <input className="input" value={form.withdrawAmt} onChange={(e) => setForm({ ...form, withdrawAmt: e.target.value })} />
          <button className="btn col-span-3" disabled={!!busy || !isAddress(form.withdrawTo)} onClick={() => submit(encode.withdraw(getAddress(form.withdrawTo), parseUnits6(form.withdrawAmt)), `Withdraw ${form.withdrawAmt} USDT`)}>Withdraw (needs World ID)</button>
        </div>
      </section>

      {pendingApproval && (
        <section className="card space-y-2 border-[var(--color-brand)]">
          <h2 className="font-semibold">This change loosens your mandate</h2>
          <p className="text-sm muted">It needs a fresh World ID check plus your Falcon signature.</p>
          <ApprovalRunner approvalId={pendingApproval} vault={vault} chainId={chainId} signer={signer} onDone={refresh} />
        </section>
      )}
      {busy && <div className="text-sm">{busy}</div>}
      {msg && (
        <div className={`text-sm ${msg.ok ? "text-[var(--color-ok)]" : "text-[var(--color-bad)]"}`}>
          {msg.text}{" "}
          {msg.tx && <a className="underline" href={explorerTx(msg.tx)} target="_blank" rel="noreferrer">view tx</a>}
        </div>
      )}
    </div>
  );
}
