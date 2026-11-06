"use client";
// Placeholder: replaced by the Figma Home screen (glow card, needs-you alerts, agent, merchants, brake, sheets).
import type { Config } from "@/app/page";
import type { OwnerSigner } from "@/lib/client/signer";
import { Mandate } from "@/components/Mandate";
import { useShell } from "@/components/leash/shell";

export function HomeScreen({ vault, cfg, signer }: { vault: string; cfg: Config; signer: OwnerSigner | null }) {
  const { setTab } = useShell();
  return <Mandate vault={vault} chainId={cfg.chainId} signer={signer} demoAgent={cfg.demoAgent} goRequests={() => setTab("requests")} />;
}
