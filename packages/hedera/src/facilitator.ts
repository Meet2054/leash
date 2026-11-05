import { AccountId, Client } from "@hiero-ledger/sdk";
import {
  createHederaClient,
  createHederaPreflightTransfer,
  createHederaSignAndSubmitTransaction,
  createHederaVerifyPayerSignature,
  toFacilitatorHederaSigner,
} from "@x402/hedera";
import { ExactHederaScheme } from "@x402/hedera/exact/facilitator";
import type { PaymentPayload, PaymentRequirements, SchemeNetworkFacilitator, SettleResponse, VerifyResponse } from "@x402/core/types";
import { parseHederaKey } from "./hcs";

export const HEDERA_TESTNET = "hedera:testnet" as const;
export const HEDERA_USDC_TESTNET = "0.0.429274";

/**
 * Leash mandate for a Hedera payer, enforced by the facilitator (off-chain) before it co-signs and
 * pays the fee. Weaker than the Whitechain vault (which enforces onchain), and stated as such.
 */
export type HederaMandate = {
  payer: string; // agent account id
  merchants: string[]; // allowlist (payTo account ids)
  asset: string; // HTS token id, or "0.0.0" for HBAR; amounts below are in its atomic units
  perPaymentMax: bigint;
  dailyCap: bigint; // per UTC day
  /** payments above this need a human approval (World-gated); refused otherwise */
  approvalAbove: bigint;
  revoked?: boolean;
};

export type PolicyEvent = { kind: "HederaPaymentRefused" | "HederaPaymentSettled"; payer?: string; payTo: string; amount: string; reason?: string; transaction?: string };

export type MandateStore = {
  get(payer: string): HederaMandate | undefined;
  spentToday(payer: string): bigint;
  addSpent(payer: string, amount: bigint): void;
};

export function memoryMandateStore(mandates: HederaMandate[]): MandateStore & { all: () => HederaMandate[] } {
  const by = new Map(mandates.map((m) => [m.payer, m]));
  let day = new Date().toISOString().slice(0, 10);
  const spent = new Map<string, bigint>();
  const roll = () => {
    const d = new Date().toISOString().slice(0, 10);
    if (d !== day) (day = d), spent.clear();
  };
  return {
    get: (p) => by.get(p),
    spentToday: (p) => (roll(), spent.get(p) ?? 0n),
    addSpent: (p, a) => (roll(), spent.set(p, (spent.get(p) ?? 0n) + a)),
    all: () => [...by.values()],
  };
}

/** Policy check shared by verify and settle. Returns a refusal reason or undefined. */
export function checkMandate(store: MandateStore, payer: string | undefined, req: PaymentRequirements): string | undefined {
  if (!payer) return "leash_unknown_payer";
  const m = store.get(payer);
  if (!m) return "leash_no_mandate_for_payer";
  if (m.revoked) return "leash_session_revoked";
  if (req.asset !== m.asset) return "leash_asset_not_allowed";
  if (!m.merchants.includes(req.payTo)) return "leash_merchant_not_allowed";
  const amount = BigInt(req.amount);
  if (amount > m.approvalAbove) return "leash_human_approval_required";
  if (amount > m.perPaymentMax) return "leash_exceeds_per_payment_max";
  if (store.spentToday(payer) + amount > m.dailyCap) return "leash_exceeds_daily_cap";
  return undefined;
}

/**
 * x402 `exact` on hedera:testnet through OUR facilitator (we are the fee payer, so the agent holds no HBAR),
 * wrapped with the Leash mandate: allowlisted merchants, per-payment max, daily cap, human approval above a threshold.
 */
export class LeashHederaFacilitator implements SchemeNetworkFacilitator {
  readonly scheme = "exact";
  readonly caipFamily = "hedera:*";
  private readonly inner: ExactHederaScheme;

  constructor(
    readonly operatorId: string,
    operatorKey: string,
    private readonly store: MandateStore,
    private readonly onEvent: (e: PolicyEvent) => void = () => undefined,
  ) {
    const key = parseHederaKey(operatorKey);
    const build = (network: string): Client => {
      const c = createHederaClient(network);
      c.setOperator(AccountId.fromString(operatorId), key);
      return c;
    };
    this.inner = new ExactHederaScheme(
      toFacilitatorHederaSigner({
        getAddresses: () => [operatorId],
        signAndSubmitTransaction: createHederaSignAndSubmitTransaction(build, key),
        verifyPayerSignature: createHederaVerifyPayerSignature(),
        preflightTransfer: createHederaPreflightTransfer(),
      }),
    );
  }

  getExtra(network: string) {
    return this.inner.getExtra(network);
  }
  getSigners(network: string) {
    return this.inner.getSigners(network);
  }

  async verify(payload: PaymentPayload, req: PaymentRequirements): Promise<VerifyResponse> {
    const v = await this.inner.verify(payload, req);
    if (!v.isValid) return v;
    const reason = checkMandate(this.store, v.payer, req);
    if (reason) {
      this.onEvent({ kind: "HederaPaymentRefused", payer: v.payer, payTo: req.payTo, amount: req.amount, reason });
      return { isValid: false, invalidReason: reason, payer: v.payer };
    }
    return v;
  }

  async settle(payload: PaymentPayload, req: PaymentRequirements): Promise<SettleResponse> {
    const v = await this.inner.verify(payload, req);
    const reason = v.isValid ? checkMandate(this.store, v.payer, req) : v.invalidReason;
    if (reason) return { success: false, errorReason: reason, transaction: "", network: req.network as `${string}:${string}`, payer: v.payer };
    const s = await this.inner.settle(payload, req);
    if (s.success && v.payer) {
      this.store.addSpent(v.payer, BigInt(req.amount));
      this.onEvent({ kind: "HederaPaymentSettled", payer: v.payer, payTo: req.payTo, amount: req.amount, transaction: s.transaction });
    }
    return s;
  }
}
