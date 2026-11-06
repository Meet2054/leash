"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getAddress, isAddress } from "viem";
import { Activity as ActivityIcon, BarChart3, Inbox, KeyRound, Settings2, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { api, short, usePoll } from "@/lib/client/api";
import { localhostSigner, type OwnerSigner } from "@/lib/client/signer";
import { wasmSigner } from "@/lib/client/wasm-signer";
import { Onboard } from "@/components/Onboard";
import { Mandate } from "@/components/Mandate";
import { Approvals } from "@/components/Approvals";
import { Activity } from "@/components/Activity";
import { Stats } from "@/components/Stats";
import { PqLedger } from "@/components/PqLedger";
import { Empty } from "@/components/leash/kit";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export type Config = { chainId: number; factory: string; verifier: string; worldMode: "world" | "mock"; signerUrl: string; explorer: string; demoAgent?: string | null };
const TABS = [
  { id: "setup", label: "Setup", icon: KeyRound },
  { id: "limits", label: "Limits", icon: SlidersHorizontal },
  { id: "requests", label: "Requests", icon: Inbox },
  { id: "activity", label: "Activity", icon: ActivityIcon },
  { id: "insights", label: "Insights", icon: BarChart3 },
] as const;
type Tab = (typeof TABS)[number]["id"];

export default function Home() {
  const [cfg, setCfg] = useState<Config>();
  const [tab, setTab] = useState<Tab>("setup");
  const [vault, setVaultState] = useState<string | null>(null);
  const [signer, setSigner] = useState<OwnerSigner | null>(null);
  const [signerError, setSignerError] = useState<string>();
  const [signerKind, setSignerKind] = useState<"wasm" | "localhost">("wasm");
  const [switchTo, setSwitchTo] = useState("");

  useEffect(() => {
    api<Config>("/api/config").then(setCfg);
    try {
      const v = localStorage.getItem("leash.vault");
      if (v) (setVaultState(v), setTab("requests"));
      const k = localStorage.getItem("leash.signer");
      if (k === "wasm" || k === "localhost") setSignerKind(k);
    } catch {
      /* storage unavailable */
    }
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
    if (v) setTab("limits");
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

  const needVault = (
    <Empty icon={<ShieldCheck className="size-5" />} title="No vault yet" hint={<>Set up your vault first. It takes about a minute: <button className="underline underline-offset-4" onClick={() => setTab("setup")}>go to Setup</button>.</>} />
  );
  const body = useMemo(() => {
    if (!cfg)
      return (
        <div className="space-y-3">
          <Skeleton className="h-40 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
        </div>
      );
    if (tab === "setup") return <Onboard cfg={cfg} signer={signer} signerError={signerError} vault={vault} setVault={setVault} />;
    if (tab === "insights")
      return (
        <Tabs defaultValue="savings" className="space-y-3">
          <TabsList className="w-full">
            <TabsTrigger value="savings">Savings</TabsTrigger>
            <TabsTrigger value="pq">Post-quantum</TabsTrigger>
          </TabsList>
          <TabsContent value="savings">
            <Stats />
          </TabsContent>
          <TabsContent value="pq">
            <PqLedger />
          </TabsContent>
        </Tabs>
      );
    if (!vault) return needVault;
    if (tab === "limits") return <Mandate vault={vault} chainId={cfg.chainId} signer={signer} demoAgent={cfg.demoAgent} goRequests={() => setTab("requests")} />;
    if (tab === "requests") return <Approvals vault={vault} chainId={cfg.chainId} signer={signer} />;
    return <Activity vault={vault} />;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg, tab, signer, signerError, vault]);

  return (
    <div className="mx-auto min-h-dvh max-w-xl">
      <header className="sticky top-0 z-30 bg-background/85 px-4 pb-3 pt-[max(env(safe-area-inset-top),14px)] backdrop-blur-xl">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground">
              <ShieldCheck className="size-5" />
            </div>
            <div className="leading-tight">
              <div className="text-[1.05rem] font-semibold tracking-tight">Leash</div>
              <div className="text-[0.72rem] text-muted-foreground">Spending limits for your AI agents</div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Link href="/lab" className="rounded-full bg-primary px-3 py-1.5 text-[0.75rem] font-semibold text-primary-foreground">
              Attack lab
            </Link>
            <Link href="/docs" className="rounded-full bg-muted px-3 py-1.5 text-[0.75rem] font-medium text-foreground">
              Docs
            </Link>
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Settings">
                  <Settings2 className="size-5" />
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-sm rounded-2xl">
                <DialogHeader>
                  <DialogTitle>Settings</DialogTitle>
                  <DialogDescription>Network: Whitechain testnet ({cfg?.chainId}). Payments in USDT.</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <div className="text-[0.78rem] font-medium text-muted-foreground">Where your owner key lives</div>
                    <Select value={signerKind} onValueChange={(v) => chooseSigner(v as "wasm" | "localhost")}>
                      <SelectTrigger className="h-11 w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="wasm">In this browser (recommended)</SelectItem>
                        <SelectItem value="localhost">Local signer app (advanced)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <div className="text-[0.78rem] font-medium text-muted-foreground">Vault</div>
                    <div className="text-sm">{vault ? <span className="font-mono text-[0.8rem]">{vault}</span> : <span className="text-muted-foreground">none selected</span>}</div>
                    <div className="flex gap-2">
                      <Input className="font-mono text-[0.8rem]" placeholder="0x… open another vault" value={switchTo} onChange={(e) => setSwitchTo(e.target.value)} />
                      <Button variant="secondary" disabled={!isAddress(switchTo)} onClick={() => (setVault(getAddress(switchTo)), setSwitchTo(""))}>
                        Open
                      </Button>
                    </div>
                    {vault && (
                      <Button variant="ghost" className="px-0 text-muted-foreground" onClick={() => (setVault(null), setTab("setup"))}>
                        Forget this vault on this device
                      </Button>
                    )}
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>
        {vault && (
          <div className="mt-2 text-[0.72rem] text-muted-foreground">
            Vault <span className="font-mono">{short(vault)}</span>
          </div>
        )}
      </header>

      <main className="space-y-4 px-4 pb-[calc(env(safe-area-inset-bottom)+96px)] pt-1">{body}</main>

      <nav className="fixed inset-x-0 bottom-0 z-30 bg-background pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_rgb(0_0_0/0.5)]">
        <div className="mx-auto grid max-w-xl grid-cols-5 px-2 py-1.5">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn("relative flex flex-col items-center gap-1 rounded-xl py-2 text-[0.68rem] font-medium transition-colors", tab === id ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              <span className={cn("grid h-7 w-12 place-items-center rounded-full transition-colors", tab === id && "bg-muted")}>
                <Icon className="size-[1.15rem]" />
              </span>
              {label}
              {id === "requests" && pending > 0 && <span className="absolute right-3 top-1 grid min-w-4 place-items-center rounded-full bg-primary px-1 text-[0.6rem] font-semibold text-primary-foreground">{pending}</span>}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
