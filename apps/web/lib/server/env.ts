import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Address, Hex } from "viem";

/** Server-only configuration. Secrets (ATTESTOR_PK, WORLD_CLIENT_SECRET) never reach the browser. */
const ROOT = process.env.LEASH_ROOT ?? join(process.cwd(), "..", "..");

export const CHAIN_ID = Number(process.env.CHAIN_ID ?? 1874);
export const RPC_URL = process.env.WHITECHAIN_RPC ?? "https://rpc.testnet.whitechain.io";
export const FACILITATOR_URL = process.env.FACILITATOR_URL ?? "http://localhost:4021";
export const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
export const DB_PATH = process.env.WEB_DB ?? join(ROOT, "data", `web-${CHAIN_ID}.sqlite`);

export type Deployment = {
  chainId: number;
  token: Address;
  factory: Address;
  vaultImplementation: Address;
  ethFalconVerifier: Address;
  attestor: Address;
  relayer: Address;
  deployedAtBlock: number;
};
export const deployment: Deployment = JSON.parse(readFileSync(join(ROOT, "contracts", "deployments", `${CHAIN_ID}.json`), "utf8"));

export function attestorKey(): Hex {
  const k = process.env.ATTESTOR_PK;
  if (!k) throw new Error("ATTESTOR_PK missing");
  return k as Hex;
}

/** WORLD_MODE=world (real World IdP device flow) | mock (local RS256 issuer — MOCKED, for offline demos). */
export const WORLD = {
  mode: (process.env.WORLD_MODE ?? (process.env.WORLD_CLIENT_ID && !process.env.WORLD_CLIENT_ID.includes("placeholder") ? "world" : "mock")) as "world" | "mock",
  issuer: process.env.WORLD_ID_ISSUER ?? "https://sandbox.auth.world.org",
  clientId: process.env.WORLD_CLIENT_ID ?? "",
  clientSecret: process.env.WORLD_CLIENT_SECRET ?? "",
  /** accepted acr values; empty = accept any (sandbox) */
  acceptedAcr: (process.env.WORLD_ACCEPTED_ACR ?? "").split(",").filter(Boolean),
  /** require a fresh proof of personhood (amr contains "pop") */
  requirePop: process.env.WORLD_REQUIRE_POP !== "false",
  /** request essential acr values in the device authorization (comma list) */
  requestAcr: (process.env.WORLD_REQUEST_ACR ?? "").split(",").filter(Boolean),
  mockIssuer: `${APP_URL}/api/world/mock`,
  /** subject string the mock issuer authenticates (match the CLI bootstrap vault by default) */
  mockSubject: process.env.WORLD_MOCK_SUBJECT ?? "cli-bootstrap:owner-1",
};
