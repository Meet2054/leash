import type { FacilitatorContext } from "./context.js";

/** Signature bytes (spec §2 data math). */
export const SIG_BYTES = { ecdsa: 65, mlDsa44: 2420, ethFalcon: 1064, falcon512: 666 } as const;

/** The article's workload: 10,000 agents × 1 paid request/min. */
export function projection() {
  const requestsPerDay = 10_000 * 60 * 24; // 14.4M
  const claimsPerDay = 10_000 * 24; // hourly cumulative claims
  const ownerActionsPerDay = 10_000; // one PQ owner action per agent per day
  const pqPerPayment = requestsPerDay * SIG_BYTES.mlDsa44;
  const leash = claimsPerDay * SIG_BYTES.ecdsa + ownerActionsPerDay * SIG_BYTES.mlDsa44;
  const pqPerPaymentFalcon = requestsPerDay * SIG_BYTES.ethFalcon;
  const leashFalcon = claimsPerDay * SIG_BYTES.ecdsa + ownerActionsPerDay * SIG_BYTES.ethFalcon;
  return {
    workload: { agents: 10_000, requestsPerDay, claimsPerDay, ownerActionsPerDay },
    mlDsaBaseline: { pqPerPaymentBytes: pqPerPayment, leashBytes: leash, factor: pqPerPayment / leash },
    falconBaseline: { pqPerPaymentBytes: pqPerPaymentFalcon, leashBytes: leashFalcon, factor: pqPerPaymentFalcon / leashFalcon },
  };
}

/** Live numbers from real counts: vouchers served vs claim txs and their calldata. */
export async function computeStats(ctx: FacilitatorContext) {
  const vouchers = ctx.store.counter("vouchers_served");
  const claims = ctx.store.claimTotals();
  const pqActions = ctx.store.counter("pq_owner_actions");
  const channelsOpened = ctx.store.events(100000, "ChannelOpened").length;
  const leashSigBytes = claims.count * SIG_BYTES.ecdsa + pqActions * SIG_BYTES.ethFalcon;
  const pqPerPaymentMlDsa = vouchers * SIG_BYTES.mlDsa44;
  const pqPerPaymentFalcon = vouchers * SIG_BYTES.ethFalcon;
  return {
    network: ctx.network,
    live: {
      vouchersServed: vouchers,
      claimTxs: claims.count,
      channelsOpened,
      pqOwnerActions: pqActions,
      claimCalldataBytes: claims.calldataBytes,
      paidToMerchantsAtomic: (claims.delta - claims.fee).toString(),
      relayerFeesAtomic: claims.fee.toString(),
      claimGasCostWei: claims.costWei.toString(),
      txReductionFactor: claims.count > 0 ? vouchers / claims.count : null,
      signatureBytes: {
        leash: leashSigBytes,
        pqPerPaymentMlDsa44: pqPerPaymentMlDsa,
        pqPerPaymentEthFalcon: pqPerPaymentFalcon,
        reductionVsMlDsa44: leashSigBytes > 0 ? pqPerPaymentMlDsa / leashSigBytes : null,
        reductionVsEthFalcon: leashSigBytes > 0 ? pqPerPaymentFalcon / leashSigBytes : null,
      },
      claimsDeferredUneconomic: ctx.store.counter("claims_deferred_uneconomic"),
    },
    projection: projection(),
  };
}
