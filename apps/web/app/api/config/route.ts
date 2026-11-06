import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { CHAIN_ID, WORLD, deployment } from "@/lib/server/env";
import { ok } from "@/lib/server/http";

/** Session address of the Leash demo agent (public). From DEMO_AGENT_SESSION, else derived from its key file. */
function demoAgent(): string | null {
  if (process.env.DEMO_AGENT_SESSION) return process.env.DEMO_AGENT_SESSION;
  const f = join(process.env.LEASH_ROOT ?? join(process.cwd(), "..", ".."), "keys", "agent-session-demo.json");
  try {
    return existsSync(f) ? privateKeyToAccount(JSON.parse(readFileSync(f, "utf8")).privateKey as Hex).address : null;
  } catch {
    return null;
  }
}

export const dynamic = "force-dynamic";

/** Public, non-secret config for the owner app. */
export function GET() {
  return ok({
    chainId: CHAIN_ID,
    factory: deployment.factory,
    verifier: deployment.ethFalconVerifier,
    token: deployment.token,
    attestor: deployment.attestor,
    relayer: deployment.relayer,
    worldMode: WORLD.mode,
    worldIssuer: WORLD.mode === "mock" ? WORLD.mockIssuer : WORLD.issuer,
    signerUrl: process.env.NEXT_PUBLIC_SIGNER_URL ?? "http://127.0.0.1:8787",
    explorer: "https://explorer.testnet.whitechain.io",
    demoAgent: demoAgent(),
  });
}
