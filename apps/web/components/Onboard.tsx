"use client";
/**
 * Onboarding, built to the Figma frames "Setup · 1–4", "Vault · creating (loader)" and "Vault · ready":
 * one ticket-style card on a full-screen gradient that takes the active step's colour (blue owner key, gold
 * limits, green World ID, red create vault), then a tile-wall loader while the vault deploys, then "ready".
 */
import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { VaultLoader } from "@/components/onboard/VaultLoader";
import { getAddress, isAddress, keccak256, type Address, type Hex } from "viem";
import { ArrowLeft, Bot, Check, ChevronDown, ChevronUp, Copy, Download, Fingerprint, Fuel, Globe, Loader2, Lock, Upload } from "lucide-react";
import { toast } from "sonner";
import { encode, encodeOps, initConfigDigest, parseUnits6 } from "@leash/sdk";
import { api, explorerTx, money, short } from "@/lib/client/api";
import type { OwnerSigner } from "@/lib/client/signer";
import type { WasmSigner } from "@/lib/client/wasm-signer";
import type { Config } from "@/app/page";
import { WorldCheck, type Attempt } from "./WorldCheck";
import { Pill } from "./leash/kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

type Resource = { accepts: { payTo: string; network?: string }[]; resource: string };
type StepN = 1 | 2 | 3 | 4;

/** Per-step theme, exact from Figma. */
const THEME: Record<StepN, { page: string; hero: string; color: string; tint: string; cta: "default" | "gold" | "green" | "red" }> = {
  1: { page: "step-blue", hero: "/design/hero-blue.webp", color: "#0643d2", tint: "#eef3fe", cta: "default" },
  2: { page: "step-gold", hero: "/design/hero-gold.webp", color: "#a16b08", tint: "#fffdec", cta: "gold" },
  3: { page: "step-green", hero: "/design/hero-green.webp", color: "#096c37", tint: "#f0fff1", cta: "green" },
  4: { page: "step-red", hero: "/design/hero-red.webp", color: "#930328", tint: "#ffe9ef", cta: "red" },
};
const TITLES: Record<StepN, string> = { 1: "Your owner key", 2: "Set your agent's limits", 3: "Verify you're a human", 4: "Create your vault" };
const BODIES: Record<StepN, string> = {
  1: "Created in this browser. It's a post-quantum key (Falcon-512) and the only thing that can change your agent's limits.",
  2: "What the agent may spend, where, and for how long. You can tighten these any time without World ID.",
  3: "One World ID check links your vault to you. Only you can ever loosen its limits.",
  4: "We pay the network fee. Your agent never holds gas or a seed phrase.",
};

/** Tinted, hairline-bordered surface used for rows and inputs inside a step (r16 rows, r14 inputs). */
const tinted = "ring-1 ring-inset ring-[#222222]/12";

export function Onboard(props: { cfg: Config; signer: OwnerSigner | null; signerError?: string; vault: string | null; setVault: (v: string | null) => void; onExit?: () => void }) {
  const { signer, cfg } = props;
  const chainId = cfg.chainId;
  const [pubKeyHash, setPubKeyHash] = useState<Hex>();
  const [merchants, setMerchants] = useState<{ address: string; name: string; on: boolean }[]>([]);
  const [merchantsLoaded, setMerchantsLoaded] = useState(false);
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
  // design flow: step 1 and 2 each end with an explicit "continue"
  const [keyOk, setKeyOk] = useState(false);
  const [limitsOk, setLimitsOk] = useState(false);
  const [phase, setPhase] = useState<null | "sign" | "deploy">(null);
  const [showDeposit, setShowDeposit] = useState(false);
  const [openExisting, setOpenExisting] = useState(false);
  const [existing, setExisting] = useState("");

  const agent = useOwnAgent ? ownAgent : (cfg.demoAgent ?? "");
  // an already-selected vault: is it live, and is this browser's key its owner?
  const [current, setCurrent] = useState<{ deployed: boolean; pqPubKeyHash?: string; worldSubjectHash?: string; balance: string } | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  useEffect(() => {
    if (!props.vault) return setCurrent(null);
    api<{ deployed: boolean; pqPubKeyHash?: string; worldSubjectHash?: string; balance: string }>(`/api/vault/${props.vault}`).then(setCurrent).catch(() => setCurrent(null));
  }, [props.vault]);
  const ownsCurrent = Boolean(current?.deployed && pubKeyHash && current.pqPubKeyHash?.toLowerCase() === pubKeyHash.toLowerCase());

  useEffect(() => {
    signer?.pubKey().then((pk) => setPubKeyHash(keccak256(pk))).catch(() => setPubKeyHash(undefined));
    if (signer?.kind === "wasm")
      (signer as WasmSigner)
        .protection()
        .then((p) => (setProtection(p), p === "passkey" && setKeyOk(true)))
        .catch(() => undefined);
    else if (signer) setKeyOk(true); // local signer app: nothing to protect here
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
      .catch(() => undefined)
      .finally(() => setMerchantsLoaded(true));
  }, [chainId]);

  const vaultAddr = attempt?.status === "APPROVED" ? attempt.vault : null;
  useEffect(() => {
    const addr = created?.vault ?? vaultAddr;
    if (!addr) return;
    const load = async () => {
      try {
        setBalance((await api<{ balance: string }>(`/api/vault/${addr}`)).balance);
      } catch {
        /* ignore */
      }
    };
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [vaultAddr, created?.vault]);

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
      setPhase("sign");
      const digest = initConfigDigest(chainId, cfg.factory as Address, attempt.initConfig);
      if (digest.toLowerCase() !== attempt.changeHash?.toLowerCase()) throw new Error("The server's vault config doesn't match. Refusing to sign.");
      const pqSig = await signer.sign(digest, "InitConfig");
      setBusy("Creating your vault (we pay the gas)…");
      setPhase("deploy");
      const r = await api<{ vault: string; txHash: string }>(`/api/onboard/${attempt.attemptId}/create`, { pqPubKey: await signer.pubKey(), pqSig });
      setCreated(r);
      // remember it right away (the app shell reads this key), so a reload on the "ready" screen keeps the vault
      try {
        localStorage.setItem("leash.vault", r.vault);
      } catch {
        /* storage unavailable */
      }
      toast.success("Vault created");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(undefined);
      setPhase(null);
    }
  };

  const keyReady = Boolean(signer && pubKeyHash);
  const limitsReady = keyReady && isAddress(agent) && merchants.some((m) => m.on);
  const worldDone = attempt?.status === "APPROVED";
  const active: StepN = !keyReady || !keyOk ? 1 : !limitsOk || !limitsReady ? 2 : !worldDone ? 3 : 4;
  const theme = THEME[active];

  // ---------------------------------------------------------------- loader / ready / all-set screens
  if (props.vault && current?.deployed && !showWizard) {
    const linked = Boolean(current.worldSubjectHash && !/^0x0+$/.test(current.worldSubjectHash));
    return (
      <ReadyScreen
        title={ownsCurrent ? "You're all set" : "Watching a vault"}
        body={ownsCurrent ? "Your vault is live. You don't need to verify again: World ID is only asked when you raise a limit." : "This browser doesn't hold this vault's owner key, so you can look but not change its limits."}
        chips={[
          { dot: ownsCurrent ? "#0643d2" : "#9095a3", label: ownsCurrent ? `Owner key here${protection === "passkey" ? " · passkey" : ""}` : "Key not on this device" },
          { dot: linked ? "#096c37" : "#9095a3", label: "World ID" },
          { dot: "#a16b08", label: `${money(current.balance)} USDT` },
        ]}
        extra={
          <div className="space-y-2">
            <div className="font-mono text-[13px] text-ink">{short(props.vault, 6)}</div>
            <p className="max-w-[300px] text-[12px] leading-4 text-muted-ink">To try setup from scratch as a new user, open permissionless.in in a private window. This browser&apos;s key already owns this vault.</p>
          </div>
        }
        primary={{ label: "Open my vault", onClick: () => props.setVault(props.vault) }}
        secondary={{ label: "Show setup steps", onClick: () => setShowWizard(true) }}
        onExit={props.onExit}
      />
    );
  }

  // ---------------------------------------------------------------- the 4-step ticket card
  const stateOf = (n: StepN): "done" | "active" | "todo" => (n < active ? "done" : n === active ? "active" : "todo");
  const reopen = (n: StepN) => {
    if (attemptId) return; // the World check is bound to the limits already sent
    if (n === 1) (setKeyOk(false), setLimitsOk(false));
    if (n === 2) setLimitsOk(false);
  };

  return (
    <div className="relative isolate min-h-dvh w-full" style={{ ["--step" as string]: theme.color }}>
      <VaultLoader
        stage={created ? "done" : phase}
        chips={[
          { dot: "#a16b08", label: `${cap} USDT · ${ttlHours} h` },
          { dot: "#096c37", label: "World ID" },
          { dot: "#0643d2", label: created ? short(created.vault, 4) : "your vault", mono: true },
        ]}
        txUrl={created ? explorerTx(created.txHash) : undefined}
        onGo={() => created && props.setVault(created.vault)}
      />
      <div className="fixed inset-0 -z-10" aria-hidden>
        {([1, 2, 3, 4] as StepN[]).map((n) => (
          <div key={n} className={cn("absolute inset-0 transition-opacity duration-700 ease-in-out", THEME[n].page, n === active ? "opacity-100" : "opacity-0")} />
        ))}
      </div>
      <div className="mx-auto flex w-full max-w-[430px] flex-col gap-6 px-5 pb-10 pt-[max(env(safe-area-inset-top),52px)]">
        {props.onExit && (
          <button type="button" onClick={props.onExit} className="-mb-2 inline-flex items-center gap-1.5 self-start rounded-full bg-white/15 px-3 py-1.5 text-[13px] font-medium text-white backdrop-blur hover:bg-white/25">
            <ArrowLeft className="size-4" /> Back to my vault
          </button>
        )}
        <h1 className="text-center text-[36px] font-semibold leading-10 tracking-[-0.035em] text-white">
          Give your agent
          <br />a leash
        </h1>

        <div className="relative">
          {([1, 2, 3, 4] as StepN[]).map((n, i) => (
            <div key={n} className={cn("relative bg-white", n === 1 ? "notch-b rounded-t-[22px]" : n === 4 ? "notch-t rounded-b-[22px]" : "notch-tb")}>
              {n === 1 && (
                <div className="p-2.5">
                  {/* hero art cross-fades with the step colour */}
                  <div className="relative h-[240px] overflow-hidden rounded-[18px]">
                    {([1, 2, 3, 4] as StepN[]).map((h) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={h} src={THEME[h].hero} alt="" className={cn("absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ease-in-out", h === active ? "opacity-100" : "opacity-0")} />
                    ))}
                  </div>
                </div>
              )}
              {i > 0 && <Divider color={theme.color} />}
              <StepBlock n={n} state={stateOf(n)} color={theme.color} onReopen={!attemptId && n < active ? () => reopen(n) : undefined}>
                {n === 1 && (
                  <KeyStep
                    keyReady={keyReady}
                    pubKeyHash={pubKeyHash}
                    signer={signer}
                    signerError={props.signerError}
                    protection={protection}
                    onProtect={async () => {
                      try {
                        await downloadBackup(); // the backup is the only way back if the passkey is lost
                        await (signer as WasmSigner).protectWithPasskey();
                        setProtection("passkey");
                        setKeyOk(true);
                        toast.success("Key protected with your passkey. Keep the backup file somewhere safe.");
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : String(e));
                      }
                    }}
                    onBackup={() => downloadBackup().catch((e) => toast.error(e instanceof Error ? e.message : String(e)))}
                    onRestore={async (f) => {
                      await (signer as WasmSigner).importBackup(await f.text());
                      location.reload();
                    }}
                    onContinue={() => setKeyOk(true)}
                  />
                )}
                {n === 2 && (
                  <div className="space-y-3.5 text-left">
                    <div className={cn("flex items-center gap-3 rounded-[16px] px-3.5 py-3", tinted)} style={{ background: THEME[2].tint }}>
                      <div className="grid size-10 shrink-0 place-items-center rounded-full bg-white text-amber">
                        <Bot className="size-5 stroke-[1.7]" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[16px] font-semibold leading-[22px] tracking-[-0.005em] text-[#1f2230]">{useOwnAgent ? "My own agent" : "Leash demo agent"}</div>
                        <div className="truncate font-mono text-[13px] leading-[18px] text-blue">{agent ? short(agent, 8) : "paste your agent's session address"}</div>
                      </div>
                      <div className="flex items-center gap-2 text-[14px] text-addr">
                        Own
                        <Switch checked={useOwnAgent} onCheckedChange={setUseOwnAgent} aria-label="Use my own agent" />
                      </div>
                    </div>
                    {useOwnAgent && <TintInput tint={THEME[2].tint} className="font-mono text-[14px]" placeholder="0x… agent session key address" value={ownAgent} onChange={setOwnAgent} />}

                    <div className="grid grid-cols-2 gap-3">
                      <TintField label="Spending cap (USDT)">
                        <TintInput tint={THEME[2].tint} inputMode="decimal" value={cap} onChange={setCap} />
                      </TintField>
                      <TintField label="Valid for (hours)">
                        <TintInput tint={THEME[2].tint} inputMode="numeric" value={ttlHours} onChange={setTtlHours} />
                      </TintField>
                    </div>

                    <div className="space-y-2">
                      <div className="text-[14px] leading-5 tracking-[-0.005em] text-[#4a4f5e]">Where it may pay</div>
                      {merchants.length === 0 && (
                        <div className={cn("flex items-center gap-2 rounded-[16px] px-4 py-5 text-[14px] text-[#4a4f5e]", tinted)} style={{ background: THEME[2].tint }}>
                          {merchantsLoaded ? "No merchants found right now." : <><Loader2 className="size-4 animate-spin text-amber" /> Loading merchants…</>}
                        </div>
                      )}
                      {merchants.map((m, j) => (
                        <div key={m.address} className={cn("flex items-center justify-between gap-1.5 rounded-[16px] px-4 py-3", tinted)} style={{ background: THEME[2].tint }}>
                          <div className="min-w-0">
                            <div className="text-[16px] font-semibold capitalize leading-[22px] text-[#1f2230]">{m.name}</div>
                            <div className="font-mono text-[13px] leading-[18px] text-addr">{m.address.slice(0, 10)}…</div>
                          </div>
                          <Switch checked={m.on} aria-label={`Allow ${m.name}`} onCheckedChange={(on) => setMerchants(merchants.map((x, k) => (k === j ? { ...x, on } : x)))} />
                        </div>
                      ))}
                    </div>

                    <button type="button" className="flex items-center gap-2 py-3 text-[15px] font-semibold text-amber" onClick={() => setAdvanced(!advanced)}>
                      {advanced ? <ChevronUp className="size-[18px]" /> : <ChevronDown className="size-[18px]" />} Per-merchant limits
                    </button>
                    {advanced && (
                      <div className="grid grid-cols-2 gap-3">
                        <TintField label="Daily cap per merchant">
                          <TintInput tint={THEME[2].tint} inputMode="decimal" value={daily} onChange={setDaily} />
                        </TintField>
                        <TintField label="Max per payment channel">
                          <TintInput tint={THEME[2].tint} inputMode="decimal" value={maxChannel} onChange={setMaxChannel} />
                        </TintField>
                      </div>
                    )}
                    <Button variant="gold" className="w-full" disabled={!limitsReady} onClick={() => setLimitsOk(true)}>
                      Continue
                    </Button>
                  </div>
                )}
                {n === 3 &&
                  (!attemptId ? (
                    <Button variant="green" className="w-full" disabled={!limitsReady || !!busy} onClick={linkWorld}>
                      {busy ? <Loader2 className="animate-spin" /> : <Globe />} Verify with World ID
                    </Button>
                  ) : (
                    <div className="text-left">
                      <WorldCheck attemptId={attemptId} onDone={setAttempt} onRetry={() => (setAttemptId(undefined), setAttempt(undefined))} />
                    </div>
                  ))}
                {n === 4 && vaultAddr && (
                  <div className="space-y-3 text-left">
                    <div className={cn("space-y-2.5 rounded-[16px] px-4 py-3.5", tinted)} style={{ background: THEME[4].tint }}>
                      {[
                        ["Agent", useOwnAgent ? `My agent ${short(agent, 4)}` : "Leash demo agent"],
                        ["Spending cap", `${cap} USDT`],
                        ["Valid for", `${ttlHours} hours`],
                        ["Merchants", merchants.filter((m) => m.on).map((m) => m.name.charAt(0).toUpperCase() + m.name.slice(1)).join(", ")],
                      ].map(([k, v]) => (
                        <div key={k} className="flex items-start justify-between gap-3 text-[14px] leading-5">
                          <span className="shrink-0 text-[#4a4f5e]">{k}</span>
                          <span className="text-right font-semibold text-[#1f2230]">{v}</span>
                        </div>
                      ))}
                    </div>
                    <Button variant="red" className="w-full" disabled={!!busy} onClick={create}>
                      {busy ? <Loader2 className="animate-spin" /> : null} {busy ?? "Create vault"}
                    </Button>
                    <div className="flex items-center justify-center gap-1.5 text-[14px] text-addr">
                      <Fuel className="size-3.5" /> Network fee: paid by Leash
                    </div>
                    <button type="button" className="mx-auto block text-[13px] font-medium text-red underline-offset-4 hover:underline" onClick={() => setShowDeposit(!showDeposit)}>
                      {showDeposit ? "Hide deposit address" : "Fund it first? Show the deposit address"}
                    </button>
                    {showDeposit && (
                      <div className={cn("flex items-center gap-4 rounded-[16px] bg-white p-3", tinted)}>
                        <div className="shrink-0 rounded-[12px] bg-white p-1.5">
                          <QRCodeSVG value={vaultAddr} size={88} />
                        </div>
                        <div className="min-w-0 space-y-1.5">
                          <div className="text-[13px] leading-[18px] text-[#4a4f5e]">Send USDT on Whitechain testnet to this address. It works before the vault exists.</div>
                          <CopyText value={vaultAddr} display={short(vaultAddr, 6)} color="#930328" />
                          <div className="text-[13px] text-[#4a4f5e]">
                            Balance <span className="num font-semibold text-[#1f2230]">{money(balance)} USDT</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </StepBlock>
            </div>
          ))}
        </div>

        {props.vault && !current?.deployed && (
          <div className="flex items-center justify-between gap-3 rounded-[18px] bg-white/95 px-4 py-3 text-[13px] text-[#4a4f5e]">
            <span className="min-w-0">
              You already have a vault <span className="font-mono text-ink">{short(props.vault, 4)}</span>
            </span>
            <Button size="xs" variant="secondary" onClick={() => props.setVault(props.vault)}>
              Open it
            </Button>
          </div>
        )}

        <div className="space-y-3 text-center text-[13px] text-white/85">
          {openExisting ? (
            <div className="flex gap-2 rounded-[18px] bg-white p-2">
              <Input className="h-10 rounded-[12px] font-mono text-[13px]" placeholder="0x… vault address" value={existing} onChange={(e) => setExisting(e.target.value)} />
              <Button size="sm" disabled={!isAddress(existing)} onClick={() => props.setVault(getAddress(existing))}>
                Open
              </Button>
            </div>
          ) : (
            <button type="button" className="font-medium text-white underline-offset-4 hover:underline" onClick={() => setOpenExisting(true)}>
              Open an existing vault
            </button>
          )}
          <div className="flex items-center justify-center gap-2">
            <a href="/lab" className="hover:text-white">
              Attack lab
            </a>
            <span aria-hidden>·</span>
            <a href="/usecase" className="hover:text-white">
              Use case
            </a>
            <span aria-hidden>·</span>
            <a href="/docs" className="hover:text-white">
              Docs
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- pieces

function StepBlock({ n, state, color, onReopen, children }: { n: StepN; state: "done" | "active" | "todo"; color: string; onReopen?: () => void; children?: React.ReactNode }) {
  if (state === "active")
    return (
      <section className="flex flex-col items-center gap-3 px-6 py-[22px] text-center">
        <h2 className="text-[22px] font-semibold leading-[31px] tracking-[-0.015em] text-[#1f2230]">{TITLES[n]}</h2>
        <p className="text-[14px] leading-5 tracking-[-0.005em] text-[#4a4f5e]">{BODIES[n]}</p>
        <div className="w-full">{children}</div>
      </section>
    );
  const inner =
    state === "done" ? (
      <span className="inline-flex items-center gap-2 transition-colors duration-700" style={{ color }}>
        <span className="text-[20px] font-semibold leading-7 tracking-[-0.015em]">{TITLES[n]}</span>
        <span className="grid size-5 place-items-center rounded-full text-white" style={{ background: color }}>
          <Check className="size-3 stroke-[3.5]" />
        </span>
      </span>
    ) : (
      <span className="text-[20px] font-semibold leading-7 tracking-[-0.015em] text-[#8c91a0]">{TITLES[n]}</span>
    );
  return (
    <section className="flex justify-center px-6 py-[22px]">
      {onReopen ? (
        <button type="button" onClick={onReopen} title="Change this step" className="rounded-lg">
          {inner}
        </button>
      ) : (
        inner
      )}
    </section>
  );
}

/**
 * Ticket divider: 2.5px dashed line (7/5) in the step colour at 55%. The notches at both ends are real
 * cut-outs in the card (CSS masks .notch-t/.notch-b/.notch-tb), so the page background shows through.
 */
function Divider({ color }: { color: string }) {
  return <div aria-hidden className="absolute inset-x-[14px] top-0 h-[2.5px] opacity-55 transition-[background-image] duration-700" style={{ backgroundImage: `repeating-linear-gradient(90deg, ${color} 0 7px, transparent 7px 12px)` }} />;
}

function KeyStep(props: {
  keyReady: boolean;
  pubKeyHash?: Hex;
  signer: OwnerSigner | null;
  signerError?: string;
  protection: "none" | "passkey";
  onProtect: () => void;
  onBackup: () => void;
  onRestore: (f: File) => void;
  onContinue: () => void;
}) {
  if (!props.keyReady)
    return (
      <div className="flex items-center justify-center gap-2 py-2 text-[14px] text-[#4a4f5e]">
        {props.signerError ? <span>{props.signerError}. Reload the page to create a key in this browser.</span> : <><Loader2 className="size-4 animate-spin text-blue" /> Creating your key…</>}
      </div>
    );
  const wasm = props.signer?.kind === "wasm";
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex flex-wrap items-center justify-center gap-2">
        <CopyText value={props.pubKeyHash!} display={short(props.pubKeyHash!, 6)} color="#0643d2" border="#5c84dd" />
        {wasm ? props.protection === "passkey" ? <Pill tone="ok"><Lock className="size-3" /> Passkey-protected</Pill> : null : <Pill tone="blue">Local signer</Pill>}
      </div>
      {wasm && props.protection === "none" && (
        <Button className="w-full" onClick={props.onProtect}>
          <Fingerprint /> Protect with passkey
        </Button>
      )}
      {(!wasm || props.protection === "passkey") && (
        <Button className="w-full" onClick={props.onContinue}>
          Continue
        </Button>
      )}
      {wasm && (
        <div className="grid w-full grid-cols-2 gap-3">
          <Button variant="secondary" onClick={props.onBackup}>
            <Download /> Back up key
          </Button>
          <Button variant="secondary" asChild>
            <label className="cursor-pointer">
              <Upload /> Restore
              <input
                type="file"
                accept="application/json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) props.onRestore(f);
                }}
              />
            </label>
          </Button>
        </div>
      )}
      {wasm && props.protection === "none" && (
        <button type="button" className="text-[13px] text-addr underline-offset-4 hover:text-ink hover:underline" onClick={props.onContinue}>
          Continue without a passkey
        </button>
      )}
    </div>
  );
}

function CopyText({ value, display, color, border }: { value: string; display: string; color: string; border?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex items-center gap-2 rounded-[12px] px-3 py-2 font-mono text-[13px] leading-[18px] tracking-[-0.005em]"
      style={{ color, boxShadow: border ? `inset 0 0 0 1.5px ${border}` : undefined }}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          toast.success("Copied");
          setTimeout(() => setDone(false), 1200);
        } catch {
          /* clipboard unavailable */
        }
      }}
    >
      {display}
      {done ? <Check className="size-[15px]" /> : <Copy className="size-[15px] stroke-[1.5]" />}
    </button>
  );
}

function TintField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-2">
      <span className="block text-[14px] leading-5 tracking-[-0.005em] text-[#4a4f5e]">{label}</span>
      {children}
    </label>
  );
}

function TintInput({ tint, value, onChange, className, ...rest }: { tint: string; value: string; onChange: (v: string) => void; className?: string; placeholder?: string; inputMode?: "decimal" | "numeric" }) {
  return <Input {...rest} value={value} onChange={(e) => onChange(e.target.value)} className={cn("h-[52px] rounded-[14px] px-4 text-[16px] text-[#1f2230]", tinted, className)} style={{ background: tint }} />;
}

// ---------------------------------------------------------------- tile wall (loader + ready)

const COLS = [-42, 32, 106, 180, 254, 328, 402];
const ROWS = Array.from({ length: 14 }, (_, i) => -50 + i * 74);
/** The flipped tiles that draw the mark while the vault is created (Figma "Tile/flipped"): [col, row, bar?]. */
const MARK: [number, number, boolean][] = [
  [3, 4, true],
  [2, 5, false],
  [4, 5, false],
  [2, 6, false],
  [4, 6, false],
  [2, 7, true],
  [3, 7, false],
  [4, 7, true],
];

function TileWall({ mark }: { mark?: { from: string; to: string; shadow: string } }) {
  const marked = new Set(mark ? MARK.map(([c, r]) => `${c}:${r}`) : []);
  return (
    <div className="pointer-events-none absolute left-1/2 top-[calc(50%-466px)] h-[932px] w-[430px] -translate-x-1/2 bg-[#e3e5eb]" aria-hidden>
      <style>{`@keyframes leash-flip{0%,100%{transform:scaleY(1)}50%{transform:scaleY(.12)}}`}</style>
      {COLS.flatMap((x, c) =>
        ROWS.map((y, r) =>
          marked.has(`${c}:${r}`) ? null : (
            <div
              key={`${c}:${r}`}
              className="absolute size-[70px] rounded-[26px]"
              style={{ left: x, top: y, background: "linear-gradient(135deg,#ffffff,#eeeff3)", boxShadow: "inset 0 2px 1px #ffffff, 0 2px 4px rgb(26 31 51 / 0.08)" }}
            />
          ),
        ),
      )}
      {mark &&
        MARK.map(([c, r, bar], i) => (
          <div
            key={`m${i}`}
            className="absolute w-[70px]"
            style={{
              left: COLS[c],
              top: bar ? ROWS[r] + 28.5 : ROWS[r],
              height: bar ? 13 : 70,
              borderRadius: bar ? 6.3 : 26,
              background: `linear-gradient(135deg, ${mark.from}, ${mark.to})`,
              boxShadow: `inset 0 2px 3px rgb(255 255 255 / 0.35), 0 8px 16px -2px ${mark.shadow}`,
              animation: `leash-flip 1.6s ease-in-out ${i * 0.12}s infinite`,
            }}
          />
        ))}
      {/* vignette + bottom fade (Figma) */}
      <div className="absolute inset-0" style={{ background: "radial-gradient(circle at 50% 57%, rgb(243 244 247 / 0) 45%, rgb(243 244 247 / 0.85) 100%)" }} />
      <div className="absolute inset-x-0 bottom-0 h-[300px]" style={{ background: "linear-gradient(180deg, rgb(243 244 247 / 0) 0%, #f3f4f7 55%, #f3f4f7 100%)" }} />
    </div>
  );
}

function ReadyScreen(props: {
  title: string;
  body: React.ReactNode;
  chips: { dot: string; label: string; mono?: boolean }[];
  extra?: React.ReactNode;
  primary: { label: string; onClick: () => void };
  secondary?: { label: string; onClick: () => void };
  onExit?: () => void;
}) {
  return (
    <div className="relative min-h-dvh w-full overflow-hidden bg-[#f3f4f7]">
      <TileWall />
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[420px] w-[520px] -translate-x-1/2 -translate-y-[60%] rounded-full bg-[#f3f4f7]/90 blur-[60px]" aria-hidden />
      <div className="relative mx-auto flex min-h-dvh w-full max-w-[430px] flex-col px-4 pb-[max(env(safe-area-inset-bottom),48px)] pt-[max(env(safe-area-inset-top),20px)]">
        {props.onExit && (
          <button type="button" onClick={props.onExit} className="inline-flex items-center gap-1.5 self-start rounded-full bg-white px-3 py-1.5 text-[13px] font-medium text-ink shadow-[var(--shadow-nav)]">
            <ArrowLeft className="size-4" /> Back to my vault
          </button>
        )}
        <div className="flex flex-1 flex-col items-center justify-center gap-3.5 text-center">
          <div className="relative size-24">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/design/avatar.webp" alt="" className="size-24 rounded-full ring-[3px] ring-white" style={{ boxShadow: "0 14px 30px -4px rgb(6 67 210 / 0.35)" }} />
            <span className="absolute -bottom-0.5 -right-0.5 grid size-[30px] place-items-center rounded-full bg-green text-white ring-[3px] ring-white">
              <Check className="size-3.5 stroke-[3.5]" />
            </span>
          </div>
          <h1 className="text-[30px] font-bold leading-[34px] tracking-[-0.035em] text-ink">{props.title}</h1>
          <p className="max-w-[300px] text-[14px] leading-5 tracking-[-0.005em] text-body">{props.body}</p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {props.chips.map((c) => (
              <span key={c.label} className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1.5">
                <span className="size-1.5 rounded-full" style={{ background: c.dot }} />
                <span className={cn("leading-4 text-ink", c.mono ? "font-mono text-[13px]" : "text-[12px]")}>{c.label}</span>
              </span>
            ))}
          </div>
          {props.extra}
        </div>
        <div className="space-y-2.5">
          <Button className="w-full" onClick={props.primary.onClick}>
            {props.primary.label}
          </Button>
          {props.secondary && (
            <Button variant="secondary" className="w-full" onClick={props.secondary.onClick}>
              {props.secondary.label}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
