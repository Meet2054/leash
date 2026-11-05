import { CHAIN_ID, WORLD, deployment } from "@/lib/server/env";
import { ok } from "@/lib/server/http";

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
  });
}
