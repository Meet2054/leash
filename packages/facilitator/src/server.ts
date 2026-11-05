/**
 * Facilitator + relayer service.
 *   CHAIN=whitechain (default) | local
 *   FACILITATOR_PORT=4021, FACILITATOR_PUBLIC_URL=http://localhost:4021
 *   RELAYER_PK_WHITECHAIN, WHITECHAIN_RPC, DEPLOYMENT=contracts/deployments/1874.json
 *   BATCH_INTERVAL_MS=15000, ADMIN_TOKEN (protects /admin/* and /audit)
 */
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { whitechainSepolia } from "viem/chains";
import { parseEther, type Hex } from "viem";
import { registerAsset } from "@leash/sdk";
import { createApp, createContext, loadDeployment } from "./index.js";
import { anvilChain } from "./devnet.js";
import { hcsFromEnv } from "./hcs.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const env = (k: string, d?: string) => {
  const v = process.env[k] ?? d;
  if (v === undefined) throw new Error(`missing env ${k}`);
  return v;
};

const chainName = env("CHAIN", "whitechain");
const port = Number(env("FACILITATOR_PORT", "4021"));
const publicUrl = env("FACILITATOR_PUBLIC_URL", `http://localhost:${port}`);

const isLocal = chainName === "local";
const rpcUrl = isLocal ? env("LOCAL_RPC", "http://127.0.0.1:8545") : env("WHITECHAIN_RPC", "https://rpc.testnet.whitechain.io");
const chain = isLocal ? anvilChain(rpcUrl) : whitechainSepolia;
const deployment = loadDeployment(env("DEPLOYMENT", `${root}contracts/deployments/${isLocal ? "31337" : "1874"}.json`));
if (isLocal) registerAsset("eip155:31337", { asset: deployment.token, decimals: 6, symbol: "USDT" });

const externalLog = await hcsFromEnv();
const ctx = createContext({
  chain,
  rpcUrl,
  relayerKey: env(isLocal ? "LOCAL_RELAYER_PK" : "RELAYER_PK_WHITECHAIN") as Hex,
  deployment,
  publicUrl,
  dbPath: env("FACILITATOR_DB", `${root}data/facilitator-${chain.id}.sqlite`),
  minChannel: BigInt(env("MIN_CHANNEL", "1000000")),
  relayerMinBalanceWei: parseEther(env("RELAYER_MIN_BALANCE", isLocal ? "0" : "0.05")),
  gasFloorGwei: isLocal ? "1" : "5",
  adminToken: process.env.ADMIN_TOKEN,
  externalLog,
  engine: {
    claimMaxWaitSec: Number(env("CLAIM_MAX_WAIT_SEC", "90")),
    claimThreshold: BigInt(env("CLAIM_THRESHOLD", "2000000")),
  },
});

const app = createApp(ctx);
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, () => {
  console.log(`[facilitator] ${ctx.network} on ${publicUrl} | relayer ${ctx.relayer.address} | factory ${deployment.factory}`);
  if (externalLog) console.log(`[facilitator] audit mirror → ${JSON.stringify(externalLog.describe())}`);
});

const interval = Number(env("BATCH_INTERVAL_MS", "15000"));
setInterval(async () => {
  try {
    const txs = await ctx.engine.runBatch();
    for (const h of txs) console.log(`[batcher] claim ${h}`);
  } catch (e) {
    console.error("[batcher]", e instanceof Error ? e.message : e);
  }
}, interval);
