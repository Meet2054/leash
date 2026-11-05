import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, keccak256, toBytes, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { whitechainSepolia } from "viem/chains";
import { createSession, type LeashSession } from "@leash/sdk";

export const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

export const FACILITATOR_URL = process.env.FACILITATOR_URL ?? "http://localhost:4021";
export const MERCHANT_URL = process.env.MERCHANT_URL ?? "http://localhost:4022";
export const INBOX_URL = process.env.INBOX_URL ?? "http://localhost:3000";
export const CHAIN_ID = Number(process.env.CHAIN_ID ?? 1874);

export type Deployment = { chainId: number; token: Address; factory: Address; vaultImplementation: Address; ethFalconVerifier: Address; attestor: Address };
export const deployment: Deployment = JSON.parse(readFileSync(`${ROOT}contracts/deployments/${CHAIN_ID}.json`, "utf8"));

export const publicClient = createPublicClient({
  chain: whitechainSepolia,
  transport: http(process.env.WHITECHAIN_RPC ?? "https://rpc.testnet.whitechain.io"),
});

export const merchantAddresses = () => ({
  quote: privateKeyToAccount(process.env.MERCHANT_QUOTE_PK as Hex).address,
  translate: privateKeyToAccount(process.env.MERCHANT_TRANSLATE_PK as Hex).address,
  summarize: privateKeyToAccount(process.env.MERCHANT_SUMMARIZE_PK as Hex).address,
});

function jsonFile<T>(path: string, make: () => T): T {
  if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8")) as T;
  const v = make();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(v, null, 2), { mode: 0o600 });
  return v;
}

/** The agent's session key (ECDSA, never funded). Persisted in keys/ (gitignored). */
export function agentSession(name = process.env.AGENT_SESSION ?? "agent-session"): LeashSession {
  const k = jsonFile(`${ROOT}keys/${name}.json`, () => ({ privateKey: generatePrivateKey() }));
  return createSession(k.privateKey as Hex);
}

/** The owner's vault record written by `owner create-vault`. */
export type VaultRecord = { vault: Address; worldSubjectHash: Hex; worldSubject: string; pqPubKeyHash: Hex; createdTx?: Hex; mockedWorld: boolean };
export const vaultRecordPath = () => `${ROOT}keys/vault-${CHAIN_ID}.json`;
export function loadVault(): VaultRecord {
  // AGENT_VAULT points the agent at a vault created in the web app (owner key in the browser)
  if (process.env.AGENT_VAULT) {
    return { vault: process.env.AGENT_VAULT as Address, worldSubjectHash: "0x" as Hex, worldSubject: "(web onboarding)", pqPubKeyHash: "0x" as Hex, mockedWorld: false };
  }
  if (!existsSync(vaultRecordPath())) throw new Error("no vault yet: run `pnpm --filter @leash/agent owner create-vault`");
  return JSON.parse(readFileSync(vaultRecordPath(), "utf8"));
}
export function saveVault(v: VaultRecord) {
  writeFileSync(vaultRecordPath(), JSON.stringify(v, null, 2));
}

export const subjectHash = (sub: string): Hex => keccak256(toBytes(sub));
export const nowSec = () => BigInt(Math.floor(Date.now() / 1000));
export const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));

export async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: json(body) });
  const text = await r.text();
  if (!r.ok) throw new Error(`${url} → ${r.status}: ${text}`);
  return JSON.parse(text) as T;
}
