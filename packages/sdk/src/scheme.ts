import type { Address, Hex } from "viem";

/** x402 scheme id for Leash batched payment channels. */
export const LEASH_SCHEME = "leash-batch";

export const NETWORKS = {
  whitechain: "eip155:1874",
  hederaEvm: "eip155:296",
} as const;
export type LeashNetwork = (typeof NETWORKS)[keyof typeof NETWORKS];

export const KNOWN_ASSETS: Record<string, { asset: Address; decimals: number; symbol: string }> = {
  [NETWORKS.whitechain]: { asset: "0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7", decimals: 6, symbol: "USDT" },
  [NETWORKS.hederaEvm]: { asset: "0x0000000000000000000000000000000000068cda", decimals: 6, symbol: "USDC" },
};

/** Register a non-default asset (e.g. a local devnet token) for client spend controls and server pricing. */
export function registerAsset(network: string, a: { asset: Address; decimals: number; symbol: string }) {
  KNOWN_ASSETS[network] = a;
}

export const EXPLORERS: Record<number, { tx: (h: string) => string; address: (a: string) => string }> = {
  1874: {
    tx: (h) => `https://explorer.testnet.whitechain.io/tx/${h}`,
    address: (a) => `https://explorer.testnet.whitechain.io/address/${a}`,
  },
  296: {
    tx: (h) => `https://hashscan.io/testnet/transaction/${h}`,
    address: (a) => `https://hashscan.io/testnet/account/${a}`,
  },
  31337: { tx: (h) => `local:${h}`, address: (a) => `local:${a}` },
};

export const chainIdOfNetwork = (network: string): number => Number(network.split(":")[1]);

/** `PaymentRequirements.extra` for leash-batch (advertised by the facilitator's /supported). */
export type LeashExtra = {
  facilitatorUrl: string;
  /** suggested minimum channel lock, atomic units */
  minChannel: string;
  factory: Address;
  name: "Leash";
  version: "1";
};

/** `PaymentPayload.payload` for leash-batch. */
export type LeashPayload = {
  vault: Address;
  session: Address;
  channelId: Hex;
  /** cumulative amount for this channel after this payment, atomic units (decimal string) */
  cumulativeAmount: string;
  voucherSig: Hex;
};

/** Facilitator POST /channels/open request body. */
export type OpenChannelRequest = {
  chainId: number;
  request: { vault: Address; merchant: Address; amount: string; expiry: string; sessionNonce: string };
  sig: Hex;
};

export type OpenChannelResponse = {
  channelId: Hex;
  txHash: Hex;
  locked: string;
  expiry: string;
  explorerUrl: string;
};

/** Facilitator GET /channels/:id response. */
export type ChannelView = {
  channelId: Hex;
  vault: Address;
  session: Address;
  merchant: Address;
  locked: string;
  lastAccepted: string;
  claimedOnchain: string;
  expiry: string;
  status: "open" | "closed";
};

/** Reason codes returned by /verify (VerifyResponse.invalidReason). */
export const INVALID = {
  badPayload: "leash_bad_payload",
  wrongScheme: "leash_wrong_scheme_or_network",
  badSignature: "leash_invalid_voucher_signature",
  unknownChannel: "leash_unknown_channel",
  channelClosed: "leash_channel_closed",
  channelExpiring: "leash_channel_expiring",
  merchantMismatch: "leash_merchant_mismatch",
  sessionMismatch: "leash_session_mismatch",
  sessionInactive: "leash_session_revoked_or_expired",
  insufficientIncrement: "leash_insufficient_increment",
  exceedsLocked: "leash_exceeds_locked",
  rateLimited: "leash_rate_limited",
  vaultNotLeash: "leash_vault_not_from_factory",
} as const;
