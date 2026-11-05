import { readFileSync } from "node:fs";
import { createPublicClient, http, type Abi, type Address, type Chain, type Hex, type PublicClient } from "viem";
import type { PaymentPayload, PaymentRequirements, SchemeNetworkFacilitator } from "@x402/core/types";
import { x402Facilitator } from "@x402/core/facilitator";
import { LEASH_SCHEME, leashFactoryAbi, leashVaultAbi, type LeashExtra } from "@leash/sdk";
import { Relayer, VAULT_SELECTORS, leashAllowRule } from "@leash/relayer";
import { Store } from "./db.js";
import { ChannelEngine, type EngineConfig } from "./engine.js";
import { StoreAudit, type ExternalLog } from "./audit.js";

export type Deployment = {
  chainId: number;
  token: Address;
  factory: Address;
  vaultImplementation: Address;
  ethFalconVerifier?: Address;
  relayer: Address;
  attestor: Address;
  claimFee: number | string;
};

export type FacilitatorConfig = {
  chain: Chain;
  rpcUrl: string;
  relayerKey: Hex;
  deployment: Deployment;
  publicUrl: string;
  dbPath?: string;
  minChannel?: bigint;
  engine?: Partial<EngineConfig>;
  relayerMinBalanceWei?: bigint;
  gasFloorGwei?: string;
  adminToken?: string;
  externalLog?: ExternalLog;
  pollingIntervalMs?: number;
  replaceAfterMs?: number;
};

export function loadDeployment(path: string): Deployment {
  return JSON.parse(readFileSync(path, "utf8")) as Deployment;
}

/** x402 facilitator side of leash-batch, registered with @x402/core's x402Facilitator. */
export class LeashSchemeFacilitator implements SchemeNetworkFacilitator {
  readonly scheme = LEASH_SCHEME;
  readonly caipFamily = "eip155:*";
  constructor(
    private readonly engine: ChannelEngine,
    private readonly extra: LeashExtra,
  ) {}
  getExtra(): Record<string, unknown> {
    return { ...this.extra };
  }
  getSigners(): string[] {
    return [this.engine.relayer.address];
  }
  verify(payload: PaymentPayload, requirements: PaymentRequirements) {
    return this.engine.verify(payload, requirements);
  }
  settle(payload: PaymentPayload, requirements: PaymentRequirements) {
    return this.engine.settle(payload, requirements);
  }
}

export type FacilitatorContext = {
  cfg: FacilitatorConfig;
  network: `${string}:${string}`;
  store: Store;
  relayer: Relayer;
  client: PublicClient;
  engine: ChannelEngine;
  x402: x402Facilitator;
  audit: StoreAudit;
  isLeashVault: (vault: Address) => Promise<boolean>;
};

export function createContext(cfg: FacilitatorConfig): FacilitatorContext {
  const network = `eip155:${cfg.chain.id}` as const;
  const client = createPublicClient({ chain: cfg.chain, transport: http(cfg.rpcUrl), pollingInterval: cfg.pollingIntervalMs ?? 1000 });
  const allow = leashAllowRule(client, cfg.deployment.factory, cfg.deployment.vaultImplementation);
  // a vault is ours iff its code is exactly an EIP-1167 clone of our implementation (selector is irrelevant)
  const isLeashVault = async (vault: Address) => {
    try {
      return await allow(vault, VAULT_SELECTORS[1]);
    } catch {
      return false;
    }
  };
  const relayer = new Relayer({
    chain: cfg.chain,
    rpcUrl: cfg.rpcUrl,
    privateKey: cfg.relayerKey,
    allow,
    errorAbis: [leashVaultAbi as Abi, leashFactoryAbi as Abi],
    gasFloorGwei: cfg.gasFloorGwei ?? "5",
    minBalanceWei: cfg.relayerMinBalanceWei,
    pollingIntervalMs: cfg.pollingIntervalMs,
    replaceAfterMs: cfg.replaceAfterMs,
    budgetLimit: (k) => {
      if (k.endsWith(":open")) return cfg.engine?.opensPerVaultPerDay ?? 200;
      if (k.endsWith(":change")) return 50;
      if (k.endsWith(":create")) return 10;
      if (k.endsWith(":claim")) return 5000;
      return undefined;
    },
  });
  const store = new Store(cfg.dbPath ?? ":memory:");
  const audit = new StoreAudit(store, cfg.externalLog);
  const engineCfg: EngineConfig = {
    chainId: cfg.chain.id,
    network,
    factory: cfg.deployment.factory,
    implementation: cfg.deployment.vaultImplementation,
    claimThreshold: 2_000_000n, // 2 USDT
    claimMaxWaitSec: 90,
    claimExpiryMarginSec: 300,
    minEconomicClaim: 10_000n, // 0.01 USDT (10× the 0.001 claim fee)
    voucherExpiryMarginSec: 60,
    opensPerVaultPerDay: 200,
    cacheTtlSec: 2,
    vouchersPerSessionPerSec: 50,
    ...cfg.engine,
  };
  const engine = new ChannelEngine(engineCfg, store, relayer, client, audit, isLeashVault);
  const extra: LeashExtra = {
    facilitatorUrl: cfg.publicUrl,
    minChannel: (cfg.minChannel ?? 1_000_000n).toString(),
    factory: cfg.deployment.factory,
    name: "Leash",
    version: "1",
  };
  const x402 = new x402Facilitator().register(network, new LeashSchemeFacilitator(engine, extra));
  return { cfg, network, store, relayer, client, engine, x402, audit, isLeashVault };
}
