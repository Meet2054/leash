import { decodeAbiParameters, encodeAbiParameters, type Address, type Hex } from "viem";

/** Mandate actions — keep in sync with `library Actions` in contracts/src/LeashTypes.sol. */
export enum Action {
  ADD_SESSION = 0,
  SET_SESSION_LIMITS = 1,
  REVOKE_SESSION = 2,
  SET_MERCHANT = 3,
  REMOVE_MERCHANT = 4,
  WITHDRAW = 5,
  ROTATE_PQ_KEY = 6,
  SET_VERIFIER = 7,
  BATCH = 8,
}

export const ACTION_NAMES: Record<Action, string> = {
  [Action.ADD_SESSION]: "ADD_SESSION",
  [Action.SET_SESSION_LIMITS]: "SET_SESSION_LIMITS",
  [Action.REVOKE_SESSION]: "REVOKE_SESSION",
  [Action.SET_MERCHANT]: "SET_MERCHANT",
  [Action.REMOVE_MERCHANT]: "REMOVE_MERCHANT",
  [Action.WITHDRAW]: "WITHDRAW",
  [Action.ROTATE_PQ_KEY]: "ROTATE_PQ_KEY",
  [Action.SET_VERIFIER]: "SET_VERIFIER",
  [Action.BATCH]: "BATCH",
};

export type Op = { action: Action; data: Hex };

const SESSION_PARAMS = [{ type: "address" }, { type: "uint64" }, { type: "uint128" }] as const;
const MERCHANT_PARAMS = [{ type: "address" }, { type: "uint128" }, { type: "uint128" }] as const;
const OPS_PARAMS = [
  {
    type: "tuple[]",
    components: [
      { name: "action", type: "uint8" },
      { name: "data", type: "bytes" },
    ],
  },
] as const;

export const encode = {
  addSession: (session: Address, expiry: bigint, cap: bigint): Op => ({
    action: Action.ADD_SESSION,
    data: encodeAbiParameters(SESSION_PARAMS, [session, expiry, cap]),
  }),
  setSessionLimits: (session: Address, expiry: bigint, cap: bigint): Op => ({
    action: Action.SET_SESSION_LIMITS,
    data: encodeAbiParameters(SESSION_PARAMS, [session, expiry, cap]),
  }),
  revokeSession: (session: Address): Op => ({
    action: Action.REVOKE_SESSION,
    data: encodeAbiParameters([{ type: "address" }], [session]),
  }),
  setMerchant: (merchant: Address, dailyCap: bigint, maxChannel: bigint): Op => ({
    action: Action.SET_MERCHANT,
    data: encodeAbiParameters(MERCHANT_PARAMS, [merchant, dailyCap, maxChannel]),
  }),
  removeMerchant: (merchant: Address): Op => ({
    action: Action.REMOVE_MERCHANT,
    data: encodeAbiParameters([{ type: "address" }], [merchant]),
  }),
  withdraw: (to: Address, amount: bigint): Op => ({
    action: Action.WITHDRAW,
    data: encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [to, amount]),
  }),
  rotatePqKey: (newPqPubKeyHash: Hex): Op => ({
    action: Action.ROTATE_PQ_KEY,
    data: encodeAbiParameters([{ type: "bytes32" }], [newPqPubKeyHash]),
  }),
  setVerifier: (verifier: Address): Op => ({
    action: Action.SET_VERIFIER,
    data: encodeAbiParameters([{ type: "address" }], [verifier]),
  }),
  batch: (ops: Op[]): Op => ({ action: Action.BATCH, data: encodeOps(ops) }),
};

/** abi.encode(Op[]) — used for InitConfig.initialMandate and BATCH data. */
export function encodeOps(ops: Op[]): Hex {
  return encodeAbiParameters(OPS_PARAMS, [ops.map((o) => ({ action: o.action, data: o.data }))]);
}

export function decodeOps(data: Hex): Op[] {
  const [ops] = decodeAbiParameters(OPS_PARAMS, data);
  return ops.map((o) => ({ action: o.action as Action, data: o.data }));
}

/** Human-readable description of a mandate op (owner app, approvals inbox, logs). */
export function describeOp(op: Op, fmt: (atomic: bigint) => string = (a) => a.toString()): string {
  switch (op.action) {
    case Action.ADD_SESSION:
    case Action.SET_SESSION_LIMITS: {
      const [s, expiry, cap] = decodeAbiParameters(SESSION_PARAMS, op.data);
      const verb = op.action === Action.ADD_SESSION ? "Add session" : "Set session";
      return `${verb} ${s}: cap ${fmt(cap)}, expires ${new Date(Number(expiry) * 1000).toISOString()}`;
    }
    case Action.REVOKE_SESSION:
      return `Revoke session ${decodeAbiParameters([{ type: "address" }], op.data)[0]}`;
    case Action.SET_MERCHANT: {
      const [m, daily, max] = decodeAbiParameters(MERCHANT_PARAMS, op.data);
      return `Allow merchant ${m}: daily cap ${fmt(daily)}, max channel ${fmt(max)}`;
    }
    case Action.REMOVE_MERCHANT:
      return `Remove merchant ${decodeAbiParameters([{ type: "address" }], op.data)[0]}`;
    case Action.WITHDRAW: {
      const [to, amount] = decodeAbiParameters([{ type: "address" }, { type: "uint256" }], op.data);
      return `Withdraw ${fmt(amount)} to ${to}`;
    }
    case Action.ROTATE_PQ_KEY:
      return `Rotate post-quantum key to ${decodeAbiParameters([{ type: "bytes32" }], op.data)[0]}`;
    case Action.SET_VERIFIER:
      return `Switch PQ verifier to ${decodeAbiParameters([{ type: "address" }], op.data)[0]}`;
    case Action.BATCH:
      return decodeOps(op.data)
        .map((o) => describeOp(o, fmt))
        .join("; ");
    default:
      return `Unknown action ${op.action}`;
  }
}
