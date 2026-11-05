import {
  encodeAbiParameters,
  hashTypedData,
  keccak256,
  type Address,
  type Hex,
  type TypedDataDomain,
} from "viem";

/**
 * EIP-712 types shared with contracts/src/LeashTypes.sol.
 * Domain: name "Leash", version "1", chainId, verifyingContract = vault (or factory for InitConfig
 * and the creation-time WorldApproval).
 */
export const LEASH_DOMAIN_NAME = "Leash";
export const LEASH_DOMAIN_VERSION = "1";

export const leashTypes = {
  OpenChannel: [
    { name: "vault", type: "address" },
    { name: "merchant", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "expiry", type: "uint64" },
    { name: "sessionNonce", type: "uint256" },
  ],
  Voucher: [
    { name: "channelId", type: "bytes32" },
    { name: "cumulativeAmount", type: "uint256" },
  ],
  MandateChange: [
    { name: "action", type: "uint8" },
    { name: "data", type: "bytes" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint64" },
  ],
  WorldApproval: [
    { name: "vault", type: "address" },
    { name: "changeHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "worldSubjectHash", type: "bytes32" },
    { name: "authTime", type: "uint64" },
    { name: "deadline", type: "uint64" },
  ],
  InitConfig: [
    { name: "pqPubKeyHash", type: "bytes32" },
    { name: "worldSubjectHash", type: "bytes32" },
    { name: "verifier", type: "address" },
    { name: "initialMandate", type: "bytes" },
  ],
  CloseChannel: [
    { name: "channelId", type: "bytes32" },
    { name: "finalAmount", type: "uint256" },
  ],
  RevokeSession: [{ name: "session", type: "address" }],
} as const;

export type OpenChannelMsg = { vault: Address; merchant: Address; amount: bigint; expiry: bigint; sessionNonce: bigint };
export type VoucherMsg = { channelId: Hex; cumulativeAmount: bigint };
export type MandateChangeMsg = { action: number; data: Hex; nonce: bigint; deadline: bigint };
export type WorldApprovalMsg = {
  vault: Address;
  changeHash: Hex;
  nonce: bigint;
  worldSubjectHash: Hex;
  authTime: bigint;
  deadline: bigint;
};
export type InitConfigMsg = { pqPubKeyHash: Hex; worldSubjectHash: Hex; verifier: Address; initialMandate: Hex };

export function leashDomain(chainId: number, verifyingContract: Address): TypedDataDomain {
  return { name: LEASH_DOMAIN_NAME, version: LEASH_DOMAIN_VERSION, chainId, verifyingContract };
}

export const openChannelDigest = (chainId: number, vault: Address, m: OpenChannelMsg) =>
  hashTypedData({ domain: leashDomain(chainId, vault), types: leashTypes, primaryType: "OpenChannel", message: m });

export const voucherDigest = (chainId: number, vault: Address, m: VoucherMsg) =>
  hashTypedData({ domain: leashDomain(chainId, vault), types: leashTypes, primaryType: "Voucher", message: m });

export const mandateChangeDigest = (chainId: number, vault: Address, m: MandateChangeMsg) =>
  hashTypedData({ domain: leashDomain(chainId, vault), types: leashTypes, primaryType: "MandateChange", message: m });

/** `verifyingContract` = vault for mandate changes, factory for vault creation. */
export const worldApprovalDigest = (chainId: number, verifyingContract: Address, m: WorldApprovalMsg) =>
  hashTypedData({
    domain: leashDomain(chainId, verifyingContract),
    types: leashTypes,
    primaryType: "WorldApproval",
    message: m,
  });

export const initConfigDigest = (chainId: number, factory: Address, m: InitConfigMsg) =>
  hashTypedData({ domain: leashDomain(chainId, factory), types: leashTypes, primaryType: "InitConfig", message: m });

export const closeChannelDigest = (chainId: number, vault: Address, m: { channelId: Hex; finalAmount: bigint }) =>
  hashTypedData({ domain: leashDomain(chainId, vault), types: leashTypes, primaryType: "CloseChannel", message: m });

export const revokeSessionDigest = (chainId: number, vault: Address, session: Address) =>
  hashTypedData({
    domain: leashDomain(chainId, vault),
    types: leashTypes,
    primaryType: "RevokeSession",
    message: { session },
  });

/** channelId = keccak256(abi.encode(vault, session, merchant, sessionNonce)) */
export function channelIdOf(vault: Address, session: Address, merchant: Address, sessionNonce: bigint): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "address" }, { type: "uint256" }],
      [vault, session, merchant, sessionNonce],
    ),
  );
}

/** CREATE2 salt for an owner's vault: keccak256(abi.encode(pqPubKeyHash, worldSubjectHash)). */
export function vaultSalt(pqPubKeyHash: Hex, worldSubjectHash: Hex): Hex {
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [pqPubKeyHash, worldSubjectHash]));
}
