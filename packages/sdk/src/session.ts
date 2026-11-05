import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import { leashDomain, leashTypes, type OpenChannelMsg, type VoucherMsg } from "./eip712";

/**
 * An agent session key: short-lived ECDSA key whose worst case is capped by the vault mandate.
 * It never holds gas and never signs a transaction — only EIP-712 messages that the relayer submits.
 */
export type LeashSession = { address: Address; privateKey: Hex; account: PrivateKeyAccount };

export function createSession(privateKey: Hex = generatePrivateKey()): LeashSession {
  const account = privateKeyToAccount(privateKey);
  return { address: account.address, privateKey, account };
}

export function signOpenChannel(session: LeashSession, chainId: number, msg: OpenChannelMsg): Promise<Hex> {
  return session.account.signTypedData({
    domain: leashDomain(chainId, msg.vault),
    types: leashTypes,
    primaryType: "OpenChannel",
    message: msg,
  });
}

export function signVoucher(session: LeashSession, chainId: number, vault: Address, msg: VoucherMsg): Promise<Hex> {
  return session.account.signTypedData({
    domain: leashDomain(chainId, vault),
    types: leashTypes,
    primaryType: "Voucher",
    message: msg,
  });
}

/** Gasless self-revocation (vault.revokeSessionBySig). Safe to replay: revocation only tightens. */
export function signRevokeSession(session: LeashSession, chainId: number, vault: Address): Promise<Hex> {
  return session.account.signTypedData({
    domain: leashDomain(chainId, vault),
    types: leashTypes,
    primaryType: "RevokeSession",
    message: { session: session.address },
  });
}
