import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { HederaMandate } from "./facilitator";

export const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const HEDERA_STATE = `${ROOT}keys/hedera-demo.json`;

/** Written by `pnpm --filter @leash/hedera setup` (keys/ is gitignored; account ids are public). */
export type HederaDemoState = {
  topicId: string;
  agent: { accountId: string; privateKey: string };
  merchant: { accountId: string; privateKey: string };
  mandate: { perPaymentMax: string; dailyCap: string; approvalAbove: string };
};

export function loadHederaState(): HederaDemoState | undefined {
  return existsSync(HEDERA_STATE) ? (JSON.parse(readFileSync(HEDERA_STATE, "utf8")) as HederaDemoState) : undefined;
}

export function mandateFromState(s: HederaDemoState): HederaMandate {
  return {
    payer: s.agent.accountId,
    merchants: [s.merchant.accountId],
    perPaymentMax: BigInt(s.mandate.perPaymentMax),
    dailyCap: BigInt(s.mandate.dailyCap),
    approvalAbove: BigInt(s.mandate.approvalAbove),
  };
}
