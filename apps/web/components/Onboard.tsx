"use client";
import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { getAddress, isAddress, keccak256, type Address, type Hex } from "viem";
import { Bot, ChevronDown, Download, Fingerprint, Loader2, Lock, Upload } from "lucide-react";
import { toast } from "sonner";
import { encode, encodeOps, initConfigDigest, parseUnits6 } from "@leash/sdk";
import { api, money } from "@/lib/client/api";
import type { OwnerSigner } from "@/lib/client/signer";
import type { WasmSigner } from "@/lib/client/wasm-signer";
import type { Config } from "@/app/page";
import { WorldCheck, type Attempt } from "./WorldCheck";
import { Copyable, Field, Pill, Section, Step, TxLink } from "./leash/kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

type Resource = { accepts: { payTo: string; network?: string }[]; resource: string };

export function Onboard(props: { cfg: Config; signer: OwnerSigner | null; signerError?: string; vault: string | null; setVault: (v: string | null) => void }) {
  const { signer, cfg } = props;
  const chainId = cfg.chainId;
  const [pubKeyHash, setPubKeyHash] = useState<Hex>();
  const [merchants, setMerchants] = useState<{ address: string; name: string; on: boolean }[]>([]);
  const [useOwnAgent, setUseOwnAgent] = useState(false);
  const [ownAgent, setOwnAgent] = useState("");
  const [cap, setCap] = useState("5");
  const [daily, setDaily] = useState("10");
  const [maxChannel, setMaxChannel] = useState("1");
  const [ttlHours, setTtlHours] = useState("24");
  const [advanced, setAdvanced] = useState(false);
  const [attemptId, setAttemptId] = useState<string>();
  const [attempt, setAttempt] = useState<Attempt>();
  const [balance, setBalance] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [created, setCreated] = useState<{ vault: string; txHash: string }>();
  // F8.3: passkey (WebAuthn PRF) encryption of the in-browser Falcon seed
  const [protection, setProtection] = useState<"none" | "passkey">("none");

  const agent = useOwnAgent ? ownAgent : (cfg.demoAgent ?? "");

  useEffect(() => {
    signer?.pubKey().then((pk) => setPubKeyHash(keccak256(pk))).catch(() => setPubKeyHash(undefined));
    if (signer?.kind === "wasm") (signer as WasmSigner).protection().then(setProtection).catch(() => undefined);
  }, [signer]);
  const downloadBackup = async () => {
    const json = await (signer as WasmSigner).exportBackup();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    a.download = "leash-owner-key-backup.json";
    a.click();
  };

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
    const load = async () => {
      try {
        setBalance((await api<{ balance: string }>(`/api/vault/${vaultAddr}`)).balance);
      } catch {
        /* ignore */
      }
    };
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [vaultAddr]);

  const initialMandate = (): Hex => {
    const now = BigInt(Math.floor(Date.now() / 1000));
    const ops = merchants.filter((m) => m.on).map((m) => encode.setMerchant(getAddress(m.address), parseUnits6(daily), parseUnits6(maxChannel)));
    if (isAddress(agent)) ops.push(encode.addSession(getAddress(agent), now + BigInt(Number(ttlHours) * 3600), parseUnits6(cap)));
    return encodeOps(ops);
  };

  const linkWorld = async () => {
    if (!pubKeyHash) return toast.error("Your owner key isn't ready yet.");
    try {
      setBusy("Starting World ID check…");
      const r = await api<{ attemptId: string }>("/api/onboard/start", { pqPubKeyHash: pubKeyHash, initialMandate: initialMandate() });
      setAttemptId(r.attemptId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(undefined);
    }
  };

  const create = async () => {
    if (!attempt?.initConfig || !signer) return;
    try {
      await signer.unlock?.();
      setBusy("Signing with your post-quantum key…");
      const digest = initConfigDigest(chainId, cfg.factory as Address, attempt.initConfig);
      if (digest.toLowerCase() !== attempt.changeHash?.toLowerCase()) throw new Error("The server's vault config doesn't match. Refusing to sign.");
      const pqSig = await signer.sign(digest, "InitConfig");
      setBusy("Creating your vault (we pay the gas)…");
      const r = await api<{ vault: string; txHash: string }>(`/api/onboard/${attempt.attemptId}/create`, { pqPubKey: await signer.pubKey(), pqSig });
      setCreated(r);
      toast.success("Vault created");
      props.setVault(r.vault);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(undefined);
    }
  };

  const keyReady = Boolean(signer && pubKeyHash);
  const limitsReady = keyReady && isAddress(agent) && merchants.some((m) => m.on);
  const worldDone = attempt?.status === "APPROVED";
  const s1 = keyReady ? "done" : "active";
  const s2 = !keyReady ? "todo" : attemptId ? "done" : "active";
  const s3 = !limitsReady ? "todo" : worldDone ? "done" : "active";
  const s4 = created ? "done" : worldDone ? "active" : "todo";

  return (
    <div className="space-y-3">
      <div className="px-1 pb-1">
        <h1 className="text-2xl font-semibold tracking-tight">Give your agent a leash</h1>
        <p className="mt-1 text-[0.88rem] leading-relaxed text-muted-foreground">Your agent pays for APIs on its own, but only within limits you set. Raising a limit always needs you: a fresh World ID check plus your own key.</p>
      </div>

      <Step n={1} state={s1} title="Your owner key" hint="Created in this browser. It's a post-quantum key (Falcon-512) and the only thing that can change your agent's limits.">
        {keyReady ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone="solid">Falcon-512</Pill>
              {signer?.kind === "wasm" ? protection === "passkey" ? <Pill tone="ok"><Lock className="size-3" /> Passkey-protected</Pill> : <Pill tone="warn">Not protected yet</Pill> : <Pill>Local signer</Pill>}
              <Copyable value={pubKeyHash!} />
            </div>
            {signer?.kind === "wasm" && (
              <div className="flex flex-wrap gap-2">
                {protection === "none" && (
                  <Button
                    onClick={async () => {
                      try {
                        await downloadBackup(); // the backup is the only way back if the passkey is lost
                        await (signer as WasmSigner).protectWithPasskey();
                        setProtection("passkey");
                        toast.success("Key protected with your passkey. Keep the backup file somewhere safe.");
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : String(e));
                      }
                    }}
                  >
                    <Fingerprint /> Protect with passkey
                  </Button>
                )}
                <Button variant="secondary" onClick={() => downloadBackup().catch((e) => toast.error(e instanceof Error ? e.message : String(e)))}>
                  <Download /> Back up key
                </Button>
                <Button variant="ghost" asChild>
                  <label className="cursor-pointer">
                    <Upload /> Restore
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
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-[0.85rem] text-muted-foreground">
            {props.signerError ? <span>{props.signerError}. Open Settings (top right) and choose &ldquo;In this browser&rdquo;.</span> : <><Loader2 className="size-4 animate-spin" /> Creating your key…</>}
          </div>
        )}
      </Step>

      <Step n={2} state={s2} title="Set your agent's limits" hint="What the agent may spend, where, and for how long. You can tighten these any time without World ID.">
        <div className="well flex items-center gap-3 p-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-card">
            <Bot className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[0.88rem] font-medium">{useOwnAgent ? "My own agent" : "Leash demo agent"}</div>
            <div className="truncate font-mono text-[0.72rem] text-muted-foreground">{agent || "paste your agent's session address"}</div>
          </div>
          <div className="flex items-center gap-2 text-[0.72rem] text-muted-foreground">
            Own
            <Switch checked={useOwnAgent} onCheckedChange={setUseOwnAgent} />
          </div>
        </div>
        {useOwnAgent && <Input className="font-mono text-[0.8rem]" placeholder="0x… agent session key address" value={ownAgent} onChange={(e) => setOwnAgent(e.target.value)} />}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Spending cap (USDT)">
            <Input inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} />
          </Field>
          <Field label="Valid for (hours)">
            <Input inputMode="numeric" value={ttlHours} onChange={(e) => setTtlHours(e.target.value)} />
          </Field>
        </div>

        <div className="space-y-1">
          <div className="text-[0.78rem] font-medium text-muted-foreground">Where it may pay</div>
          {merchants.length === 0 && <div className="well p-3 text-[0.82rem] text-muted-foreground">Looking for merchants…</div>}
          {merchants.map((m, i) => (
            <div key={m.address} className="well flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <div className="text-[0.88rem] font-medium capitalize">{m.name}</div>
                <div className="font-mono text-[0.7rem] text-muted-foreground">{m.address.slice(0, 10)}…</div>
              </div>
              <Switch checked={m.on} onCheckedChange={(on) => setMerchants(merchants.map((x, j) => (j === i ? { ...x, on } : x)))} />
            </div>
          ))}
        </div>

        <button className="flex items-center gap-1 text-[0.8rem] text-muted-foreground hover:text-foreground" onClick={() => setAdvanced(!advanced)}>
          <ChevronDown className={`size-4 transition-transform ${advanced ? "rotate-180" : ""}`} /> Per-merchant limits
        </button>
        {advanced && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Daily cap per merchant">
              <Input inputMode="decimal" value={daily} onChange={(e) => setDaily(e.target.value)} />
            </Field>
            <Field label="Max per payment channel">
              <Input inputMode="decimal" value={maxChannel} onChange={(e) => setMaxChannel(e.target.value)} />
            </Field>
          </div>
        )}
      </Step>

      <Step n={3} state={s3} title="Verify you're a human" hint="One World ID check links your vault to you. Only you can ever loosen its limits.">
        {!attemptId ? (
          <Button size="lg" className="w-full" disabled={!limitsReady || !!busy} onClick={linkWorld}>
            {busy ? <Loader2 className="animate-spin" /> : null} Verify with World ID
          </Button>
        ) : (
          <WorldCheck attemptId={attemptId} onDone={setAttempt} onRetry={() => (setAttemptId(undefined), setAttempt(undefined))} />
        )}
      </Step>

      <Step n={4} state={s4} title="Create your vault" hint="We pay the network fee. Your agent never holds gas or a seed phrase.">
        {vaultAddr && (
          <div className="space-y-3">
            {!created ? (
              <Button size="lg" className="w-full" disabled={!!busy} onClick={create}>
                {busy ? <Loader2 className="animate-spin" /> : null} {busy ?? "Sign & create vault"}
              </Button>
            ) : (
              <div className="well flex items-center justify-between gap-2 p-3 text-[0.85rem]">
                <span className="font-medium">✓ Your vault is live</span>
                <TxLink hash={created.txHash} />
              </div>
            )}
            <div className="well flex items-center gap-4 p-3">
              <div className="shrink-0 rounded-xl bg-white p-2">
                <QRCodeSVG value={vaultAddr} size={96} />
              </div>
              <div className="min-w-0 space-y-1.5">
                <div className="text-[0.8rem] text-muted-foreground">Fund it with USDT on Whitechain testnet</div>
                <Copyable value={vaultAddr} display={`${vaultAddr.slice(0, 10)}…${vaultAddr.slice(-6)}`} />
                <div className="text-[0.85rem]">
                  Balance <span className="num font-semibold">{money(balance)} USDT</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </Step>

      {props.vault && !created && (
        <Section title="You already have a vault" description={<span className="font-mono text-[0.75rem]">{props.vault}</span>}>
          <Button variant="secondary" onClick={() => props.setVault(props.vault)}>
            Open my vault
          </Button>
        </Section>
      )}
    </div>
  );
}
