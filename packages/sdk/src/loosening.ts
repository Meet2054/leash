import { keccak256, toBytes, type Address, type Hex } from "viem";
import type { LeashSession } from "./session";
import type { Op } from "./actions";

/**
 * An agent may ASK its owner to loosen the mandate (e.g. raise its cap). It can never approve:
 * approval needs the owner's post-quantum key plus a fresh World ID check, neither of which it has.
 */
export type LooseningRequest = {
  vault: Address;
  session: Address;
  op: Op;
  reason: string;
  createdAt: number;
  sig: Hex; // session's personal_sign over looseningRequestMessage(...)
};

export type LooseningStatus = {
  id: string;
  status: "PENDING" | "APPROVING" | "APPROVED" | "DENIED" | "EXPIRED" | "FAILED";
  txHash?: Hex;
  reason?: string;
};

export function looseningRequestMessage(r: Omit<LooseningRequest, "sig">): string {
  return [
    "Leash: request to loosen mandate",
    `vault: ${r.vault}`,
    `session: ${r.session}`,
    `action: ${r.op.action}`,
    `dataHash: ${keccak256(r.op.data)}`,
    `reasonHash: ${keccak256(toBytes(r.reason))}`,
    `createdAt: ${r.createdAt}`,
  ].join("\n");
}

export async function requestLoosening(args: {
  inboxUrl: string;
  session: LeashSession;
  vault: Address;
  op: Op;
  reason: string;
  fetch?: typeof fetch;
}): Promise<LooseningStatus> {
  const base = { vault: args.vault, session: args.session.address, op: args.op, reason: args.reason, createdAt: Math.floor(Date.now() / 1000) };
  const sig = await args.session.account.signMessage({ message: looseningRequestMessage(base) });
  const body: LooseningRequest = { ...base, sig };
  const res = await (args.fetch ?? fetch)(`${args.inboxUrl}/api/approvals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
  });
  if (!res.ok) throw new Error(`requestLoosening failed (${res.status}): ${await res.text()}`);
  return (await res.json()) as LooseningStatus;
}

export async function getLooseningStatus(inboxUrl: string, id: string, f: typeof fetch = fetch): Promise<LooseningStatus> {
  const res = await f(`${inboxUrl}/api/approvals/${id}`);
  if (!res.ok) throw new Error(`status failed (${res.status})`);
  return (await res.json()) as LooseningStatus;
}
