import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { HederaMandate } from "./facilitator";

export const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const HEDERA_STATE = `${ROOT}keys/hedera-demo.json`;

/** Written by `pnpm hedera:bootstrap` (keys/ is gitignored; account ids are public). */
export type HederaDemoState = {
  topicId: string;
  agent: { accountId: string; privateKey: string };
  merchant: { accountId: string; privateKey: string };
  mandate?: unknown; // legacy field; limits now come from hederaPricing()
};

export function loadHederaState(): HederaDemoState | undefined {
  return existsSync(HEDERA_STATE) ? (JSON.parse(readFileSync(HEDERA_STATE, "utf8")) as HederaDemoState) : undefined;
}

/**
 * Payment asset for the Hedera endpoints: HEDERA_PAY_ASSET=usdc (HTS token HEDERA_USDC_TOKEN_ID, default) or hbar
 * (fallback while the Circle faucet is not paying out). Prices and the mandate scale with the asset.
 * Either way the agent never pays a network fee: our facilitator is the fee payer.
 */
export function hederaPricing() {
  const hbar = (process.env.HEDERA_PAY_ASSET ?? "usdc").toLowerCase() === "hbar";
  return hbar
    ? {
        asset: "0.0.0",
        symbol: "HBAR",
        decimals: 8,
        prices: { quote: 10_000_000n, translate: 20_000_000n, report: 600_000_000n }, // 0.1 / 0.2 / 6 HBAR
        mandate: { perPaymentMax: 100_000_000n, dailyCap: 2_000_000_000n, approvalAbove: 500_000_000n }, // 1 / 20 / 5 HBAR
      }
    : {
        // HEDERA_USDC_TOKEN_ID: Circle's testnet USDC (0.0.429274) or our self-issued tUSDC (pnpm hedera:token)
        asset: process.env.HEDERA_USDC_TOKEN_ID ?? "0.0.429274",
        symbol: (process.env.HEDERA_USDC_TOKEN_ID ?? "0.0.429274") === "0.0.429274" ? "USDC" : "tUSDC",
        decimals: 6,
        prices: { quote: 10_000n, translate: 20_000n, report: 600_000n }, // 0.01 / 0.02 / 0.60 USDC
        mandate: { perPaymentMax: 100_000n, dailyCap: 2_000_000n, approvalAbove: 500_000n }, // 0.10 / 2.00 / 0.50 USDC
      };
}

export function formatHedera(atomic: bigint | string, decimals = hederaPricing().decimals): string {
  const v = BigInt(atomic);
  const base = 10n ** BigInt(decimals);
  const frac = (v % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${v / base}${frac ? "." + frac : ""}`;
}

export function mandateFromState(s: HederaDemoState): HederaMandate {
  const p = hederaPricing();
  return { payer: s.agent.accountId, merchants: [s.merchant.accountId], asset: p.asset, ...p.mandate };
}
