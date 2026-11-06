"use client";
import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { getAddress, isAddress, keccak256, type Address, type Hex } from "viem";
import { encode, encodeOps, initConfigDigest, parseUnits6 } from "@leash/sdk";
import { api, explorerAddr, explorerTx, short, usdt } from "@/lib/client/api";
import type { OwnerSigner } from "@/lib/client/signer";
import type { WasmSigner } from "@/lib/client/wasm-signer";
import { WorldCheck, type Attempt } from "./WorldCheck";

type Resource = { accepts: { payTo: string; network?: string }[]; resource: string };

export function Onboard(props: {
  chainId: number;
  factory: string;
  signer: OwnerSigner | null;
  signerError?: string;
  vault: string | null;
  setVault: (v: string | null) => void;
}) {
  const { signer, chainId, factory } = props;
  const [pubKeyHash, setPubKeyHash] = useState<Hex>();
  const [merchants, setMerchants] = useState<{ address: string; name: string; on: boolean }[]>([]);
  const [session, setSession] = useState("");
  const [cap, setCap] = useState("5");
  const [daily, setDaily] = useState("10");
  const [maxChannel, setMaxChannel] = useState("1");
  const [ttlHours, setTtlHours] = useState("24");
  const [attemptId, setAttemptId] = useState<string>();
  const [attempt, setAttempt] = useState<Attempt>();
  const [balance, setBalance] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [created, setCreated] = useState<{ vault: string; txHash: string }>();
  const [err, setErr] = useState<string>();
  const [existing, setExisting] = useState("");

  useEffect(() => {
    signer?.pubKey().then((pk) => setPubKeyHash(keccak256(pk))).catch(() => setPubKeyHash(undefined));
  }, [signer]);

  useEffect(() => {
    api<{ items: Resource[] }>("/api/facilitator/discovery/resources")
      .then((r) => {
        const seen = new Map<string, string>();
        // only this chain's merchants (discovery also lists Hedera endpoints, whose payTo is a 0.0.x account)
        for (const i of r.items) if (i.accepts[0].network === `eip155:${chainId}` && isAddress(i.accepts[0].payTo)) seen.set(i.accepts[0].payTo, new URL(i.resource).pathname.slice(1));
        setMerchants([...seen].map(([address, name]) => ({ address, name, on: true })));
      })
      .catch(() => undefined);
  }, [chainId]);

  const vaultAddr = attempt?.status === "APPROVED" ? attempt.vault : null;
  useEffect(() => {
    if (!vaultAddr) return;
    const t = setInterval(async () => {
      try {
        setBalance((await api<{ balance: string }>(`/api/vault/${vaultAddr}`)).balance);
      } catch {
        /* ignore */
      }
    }, 4000);
    return () => clearInterval(t);
  }, [vaultAddr]);

  const initialMandate = (): Hex => {
    const now = BigInt(Math.floor(Date.now() / 1000));
    const ops = merchants.filter((m) => m.on).map((m) => encode.setMerchant(getAddress(m.address), parseUnits6(daily), parseUnits6(maxChannel)));
    if (isAddress(session)) ops.push(encode.addSession(getAddress(session), now + BigInt(Number(ttlHours) * 3600), parseUnits6(cap)));
    return encodeOps(ops);
  };

  const linkWorld = async () => {
    setErr(undefined);
    if (!pubKeyHash) return setErr("Owner key not available.");
    try {
      setBusy("Starting World ID check…");
      const r = await api<{ attemptId: string }>("/api/onboard/start", { pqPubKeyHash: pubKeyHash, initialMandate: initialMandate() });
      setAttemptId(r.attemptId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(undefined);
    }
  };

  const create = async () => {
    if (!attempt?.initConfig || !signer) return;
    setErr(undefined);
    try {
      setBusy("Signing InitConfig with your Falcon key…");
      const digest = initConfigDigest(chainId, factory as Address, attempt.initConfig);
      if (digest.toLowerCase() !== attempt.changeHash?.toLowerCase()) throw new Error("server InitConfig hash mismatch — refusing to sign");
      const pqSig = await signer.sign(digest, "InitConfig");
      setBusy("Creating your vault (the relayer pays gas)…");
      const r = await api<{ vault: string; txHash: string }>(`/api/onboard/${attempt.attemptId}/create`, { pqPubKey: await signer.pubKey(), pqSig });
      setCreated(r);
      props.setVault(r.vault);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <div className="space-y-4">
      <section className="card space-y-2">
        <h2 className="font-semibold">1 · Your post-quantum owner key</h2>
        {signer && pubKeyHash ? (
          <div className="text-sm">
            <span className="pill">ETHFALCON-512</span> <span className="muted">via {signer.label}</span>
            <div className="mono mt-1">pubKeyHash {pubKeyHash}</div>
          </div>
        ) : (
          <div className="text-sm text-[var(--color-warn)]">{props.signerError ?? "No owner key yet."} Start the local signer: <span className="mono">pnpm owner-signer</span> or switch to the in-browser key (top right).</div>
        )}
        <p className="text-xs muted">Your Falcon key is the only root authority over the vault. Loosening also needs a fresh World ID check; tightening needs only this key.</p>
        {signer?.kind === "wasm" && (
          <div className="flex gap-2">
            <button
              className="btn"
              onClick={async () => {
                const json = await (signer as WasmSigner).exportBackup();
                const a = document.createElement("a");
                a.href = URL.createObjectURL(new Blob([json], { type: "application/json" }));
                a.download = "leash-owner-falcon-backup.json";
                a.click();
              }}
            >
              Export key backup
            </button>
            <label className="btn cursor-pointer">
              Import backup
              <input
                type="file"
                accept="application/json"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) (await (signer as WasmSigner).importBackup(await f.text()), location.reload());
                }}
              />
            </label>
          </div>
        )}
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">2 · Initial mandate</h2>
        <div className="space-y-1">
          {merchants.length === 0 && <div className="text-sm muted">No merchants discovered yet (is the facilitator running?).</div>}
          {merchants.map((m, i) => (
            <label key={m.address} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={m.on} onChange={(e) => setMerchants(merchants.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))} />
              <span className="font-medium">/{m.name}</span> <span className="mono muted">{short(m.address)}</span>
            </label>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <label>Merchant daily cap (USDT)<input className="input" value={daily} onChange={(e) => setDaily(e.target.value)} /></label>
          <label>Max per channel (USDT)<input className="input" value={maxChannel} onChange={(e) => setMaxChannel(e.target.value)} /></label>
          <label className="col-span-2">Agent session key (address)<input className="input mono" placeholder="0x… (from pnpm owner init)" value={session} onChange={(e) => setSession(e.target.value)} /></label>
          <label>Session cap (USDT)<input className="input" value={cap} onChange={(e) => setCap(e.target.value)} /></label>
          <label>Session lifetime (h)<input className="input" value={ttlHours} onChange={(e) => setTtlHours(e.target.value)} /></label>
        </div>
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">3 · Link World ID</h2>
        {!attemptId && (
          <button className="btn btn-primary" disabled={!pubKeyHash || !!busy} onClick={linkWorld}>
            Verify with World ID
          </button>
        )}
        {attemptId && <WorldCheck attemptId={attemptId} onDone={setAttempt} />}
      </section>

      {vaultAddr && (
        <section className="card space-y-3">
          <h2 className="font-semibold">4 · Fund your vault — no gas, no chain to pick</h2>
          <div className="flex gap-4 items-center">
            <div className="bg-white p-2 rounded-lg shrink-0">
              <QRCodeSVG value={vaultAddr} size={120} />
            </div>
            <div className="text-sm space-y-1 min-w-0">
              <div className="muted">Send USDT here (works before the vault exists):</div>
              <a className="mono underline" href={explorerAddr(vaultAddr)} target="_blank" rel="noreferrer">
                {vaultAddr}
              </a>
              <div>
                Balance: <b>{usdt(balance)}</b> USDT
              </div>
            </div>
          </div>
          {!created ? (
            <button className="btn btn-primary" disabled={!!busy} onClick={create}>
              Create vault
            </button>
          ) : (
            <div className="text-sm font-semibold text-[var(--color-ok)]">
              ✓ Vault created —{" "}
              <a className="underline" href={explorerTx(created.txHash)} target="_blank" rel="noreferrer">
                view tx
              </a>
            </div>
          )}
        </section>
      )}

      {busy && <div className="text-sm">{busy}</div>}
      {err && <div className="text-sm text-[var(--color-bad)]">{err}</div>}

      <section className="card space-y-2">
        <h2 className="font-semibold text-sm">Already have a vault?</h2>
        <div className="flex gap-2">
          <input className="input mono" placeholder="0x… vault address" value={existing} onChange={(e) => setExisting(e.target.value)} />
          <button className="btn" disabled={!isAddress(existing)} onClick={() => props.setVault(getAddress(existing))}>
            Use
          </button>
        </div>
        {props.vault && <div className="text-xs muted">Current: <span className="mono">{props.vault}</span></div>}
      </section>
    </div>
  );
}
