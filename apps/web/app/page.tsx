"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getAddress, isAddress } from "viem";
import { FlaskConical, Fingerprint, Globe, BookOpen, Briefcase, Lock, RefreshCw, SlidersHorizontal, X } from "lucide-react";
import { toast } from "sonner";
import { api, explorerAddr, usePoll } from "@/lib/client/api";
import { localhostSigner, type OwnerSigner } from "@/lib/client/signer";
import { wasmSigner, type WasmSigner } from "@/lib/client/wasm-signer";
import { passkeyErrorText } from "@/lib/client/passkey";
import { Onboard } from "@/components/Onboard";
import { HomeScreen } from "@/components/HomeScreen";
import { Approvals } from "@/components/Approvals";
import { Activity } from "@/components/Activity";
import { Insights } from "@/components/Insights";
import { Copyable, Sheet } from "@/components/leash/kit";
import { NavBar, QuickActions, ShellContext, TopBar, type QuickAction, type Tab } from "@/components/leash/shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

export type Config = { chainId: number; factory: string; verifier: string; worldMode: "world" | "mock"; signerUrl: string; explorer: string; demoAgent?: string | null };

export default function Home() {
  const [cfg, setCfg] = useState<Config>();
  const [tab, setTab] = useState<Tab>("home");
  const [setup, setSetup] = useState(false);
  const [vault, setVaultState] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [signer, setSigner] = useState<OwnerSigner | null>(null);
  const [signerError, setSignerError] = useState<string>();
  const [signerKind, setSignerKind] = useState<"wasm" | "localhost">("wasm");
  const [switchTo, setSwitchTo] = useState("");
  const [quick, setQuick] = useState(false);
  const [settings, setSettings] = useState(false);
  const [action, setAction] = useState<QuickAction | null>(null);

  useEffect(() => {
    api<Config>("/api/config").then(setCfg);
    try {
      const v = localStorage.getItem("leash.vault");
      if (v) setVaultState(v);
      const k = localStorage.getItem("leash.signer");
      if (k === "wasm" || k === "localhost") setSignerKind(k);
    } catch {
      /* storage unavailable */
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!cfg) return;
    const s = signerKind === "wasm" ? wasmSigner() : localhostSigner(cfg.signerUrl);
    s.pubKey()
      .then(() => (setSigner(s), setSignerError(undefined)))
      .catch((e) => (setSigner(null), setSignerError(e instanceof Error ? e.message : String(e))));
  }, [cfg, signerKind]);

  const setVault = (v: string | null) => {
    setVaultState(v);
    try {
      if (v) localStorage.setItem("leash.vault", v);
      else localStorage.removeItem("leash.vault");
    } catch {
      /* ignore */
    }
    if (v) (setSetup(false), setTab("home"));
  };
  const chooseSigner = (k: "wasm" | "localhost") => {
    setSignerKind(k);
    try {
      localStorage.setItem("leash.signer", k);
    } catch {
      /* ignore */
    }
  };

  const pending = usePoll<{ status: string }[]>(vault ? `/api/approvals?vault=${vault}` : null, 3000).data?.filter((a) => a.status === "PENDING").length ?? 0;
  const view = usePoll<{ worldSubjectHash?: string }>(vault ? `/api/vault/${vault}` : null, 15000).data;
  const verified = Boolean(view?.worldSubjectHash && !/^0x0*$/.test(view.worldSubjectHash));

  const startAction = (a: QuickAction | null) => {
    setQuick(false);
    if (!a || !vault) return setAction(null);
    if (a === "settings") return setSettings(true);
    if (a === "copy") {
      navigator.clipboard?.writeText(vault).then(() => toast.success("Vault address copied")).catch(() => undefined);
      return;
    }
    if (a === "explorer") return void window.open(explorerAddr(vault), "_blank", "noreferrer");
    if (a === "world-id") return setTab("requests");
    setTab("home");
    setAction(a);
  };

  const body = useMemo(() => {
    if (!cfg || !vault) return null;
    if (tab === "home") return <HomeScreen vault={vault} cfg={cfg} signer={signer} />;
    if (tab === "requests") return <Approvals vault={vault} chainId={cfg.chainId} signer={signer} />;
    if (tab === "activity") return <Activity vault={vault} />;
    return <Insights />;
  }, [cfg, tab, signer, vault]);

  // ---- loading
  if (!cfg || !loaded)
    return (
      <div className="mx-auto min-h-dvh max-w-[430px] space-y-4 px-4 pt-6">
        <Skeleton className="h-11 rounded-full" />
        <Skeleton className="h-[364px] rounded-[32px]" />
        <Skeleton className="h-40 rounded-[24px]" />
      </div>
    );

  // ---- onboarding (no vault yet, or re-running setup)
  if (!vault || setup)
    return (
      <Onboard
        cfg={cfg}
        signer={signer}
        signerError={signerError}
        vault={vault}
        setVault={setVault}
        onExit={vault ? () => setSetup(false) : undefined}
      />
    );

  // ---- the app
  return (
    <ShellContext.Provider value={{ tab, setTab, action, startAction }}>
      <div className="mx-auto min-h-dvh max-w-[430px] space-y-4 px-4 pb-[150px] pt-[max(env(safe-area-inset-top),20px)]">
        <TopBar vault={vault} verified={verified} onSettings={() => setSettings(true)} onWorld={() => setTab("requests")} />
        {body}
      </div>

      <QuickActions open={quick} vault={vault} onClose={() => setQuick(false)} onPick={startAction} />
      <NavBar tab={tab} setTab={(t) => (setQuick(false), setTab(t))} pending={pending} open={quick} onAction={() => setQuick((q) => !q)} />

      <Sheet open={settings} onOpenChange={setSettings} title="Settings" icon={<SlidersHorizontal />} hue="grey">
        <div className="flex gap-3 rounded-[16px] bg-surface p-3.5 text-[15px] leading-[21px] text-body">
          <Globe className="mt-0.5 size-[18px] shrink-0 text-blue" />
          <span>
            Network: <b className="font-semibold text-ink">Whitechain testnet ({cfg.chainId})</b>. Payments in USDT.
          </span>
        </div>
        <div className="space-y-2">
          <div className="text-[14px] text-body">Where your owner key lives</div>
          <Select value={signerKind} onValueChange={(v) => chooseSigner(v as "wasm" | "localhost")}>
            <SelectTrigger className="h-[52px] w-full rounded-[16px] border-0 bg-surface px-4 text-[16px] text-ink">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="wasm">In this browser (recommended)</SelectItem>
              <SelectItem value="localhost">Local signer app (advanced)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <KeyProtection signer={signer} />
        <div className="space-y-2">
          <div className="text-[14px] text-body">Vault</div>
          <Copyable value={vault} display={vault} className="flex h-[52px] w-full justify-between rounded-[16px] px-4 text-[13px]" />
          <div className="flex gap-2.5">
            <Input className="font-mono text-[14px]" placeholder="0x… open another vault" value={switchTo} onChange={(e) => setSwitchTo(e.target.value)} />
            <Button variant="secondary" className="px-5" disabled={!isAddress(switchTo)} onClick={() => (setVault(getAddress(switchTo)), setSwitchTo(""), setSettings(false))}>
              Open
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[
            { href: "/lab", label: "Attack lab", icon: FlaskConical },
            { href: "/usecase", label: "Use case", icon: Briefcase },
            { href: "/docs", label: "Docs", icon: BookOpen },
          ].map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className="flex flex-col items-center gap-1.5 rounded-[16px] bg-blue-bg px-2 py-3 text-[13px] font-medium text-blue">
              <Icon className="size-5" />
              {label}
            </Link>
          ))}
        </div>
        <div className="flex flex-col items-center gap-3 pt-1">
          <button type="button" className="inline-flex items-center gap-2 text-[16px] font-semibold text-blue" onClick={() => (setSettings(false), setSetup(true))}>
            <RefreshCw className="size-[18px]" /> Re-run setup
          </button>
          <button type="button" className="inline-flex items-center gap-2 text-[16px] font-semibold text-red" onClick={() => (setSettings(false), setVault(null))}>
            <X className="size-[18px]" /> Forget this vault on this device
          </button>
        </div>
      </Sheet>
    </ShellContext.Provider>
  );
}

/** Optional passkey for the owner key: shows the state, and lets the owner add one any time. */
function KeyProtection({ signer }: { signer: OwnerSigner | null }) {
  const [state, setState] = useState<"none" | "passkey" | "na">("na");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (signer?.kind === "wasm") (signer as WasmSigner).protection().then(setState).catch(() => undefined);
    else setState("na");
  }, [signer]);
  if (state === "na") return null;
  if (state === "passkey")
    return (
      <div className="flex items-center gap-3 rounded-[16px] bg-green-bg p-3.5 text-[15px] text-green">
        <Lock className="size-[18px] shrink-0" /> Owner key is protected with a passkey on this device.
      </div>
    );
  return (
    <div className="space-y-2 rounded-[16px] bg-surface p-3.5">
      <div className="text-[15px] leading-[21px] text-body">
        <b className="font-semibold text-ink">Passkey (optional).</b> Lock your owner key on this device with Face ID or your fingerprint. Everything works without it.
      </div>
      <Button
        variant="secondary"
        className="w-full"
        disabled={busy}
        onClick={async () => {
          const w = signer as WasmSigner;
          const protecting = w.protectWithPasskey(); // first, right inside the tap (iOS)
          const backup = w.exportBackup().catch(() => undefined);
          setBusy(true);
          try {
            await protecting;
            setState("passkey");
            const json = await backup;
            if (json) {
              const a = document.createElement("a");
              a.href = URL.createObjectURL(new Blob([json], { type: "application/json" }));
              a.download = "leash-owner-key-backup.json";
              a.click();
            }
            toast.success("Passkey added. Keep the backup file somewhere safe.");
          } catch (e) {
            if ((e as { name?: string })?.name === "PasskeyStep2") toast.message(e instanceof Error ? e.message : String(e));
            else toast.error(passkeyErrorText(e), { duration: 9000 });
          } finally {
            setBusy(false);
          }
        }}
      >
        <Fingerprint /> Add a passkey
      </Button>
    </div>
  );
}
