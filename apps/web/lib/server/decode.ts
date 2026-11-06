import "server-only";
import { decodeAbiParameters, type Hex } from "viem";

/**
 * F8.2 — the attestor's OWN decoder for a MandateChange. Deliberately not the SDK's: it is written
 * against the contract's ABI layout (contracts/src/LeashVault.sol `_execute`) so a bug or a tampered
 * bundle on either side shows up as a mismatch on the approval screen. Output format must match
 * `canonicalChange` in packages/sdk/src/actions.ts line for line.
 */
const NAMES = ["ADD_SESSION", "SET_SESSION_LIMITS", "REVOKE_SESSION", "SET_MERCHANT", "REMOVE_MERCHANT", "WITHDRAW", "ROTATE_PQ_KEY", "SET_VERIFIER", "BATCH"];

function usdt(x: bigint) {
  const whole = x / 1_000_000n;
  const frac = String(x % 1_000_000n);
  return `${x} (${whole}.${"000000".slice(frac.length)}${frac} USDT)`;
}
function ts(t: bigint) {
  return `${t} (${t === 0n ? "never" : new Date(Number(t) * 1000).toISOString()})`;
}
const addr = (h: string) => h.toLowerCase();

function ops(action: number, data: Hex): string[] {
  if (action === 0 || action === 1) {
    const [s, expiry, cap] = decodeAbiParameters([{ type: "address" }, { type: "uint64" }, { type: "uint128" }], data);
    return [`${NAMES[action]} session ${addr(s)} · cap ${usdt(cap)} · expiry ${ts(expiry)}`];
  }
  if (action === 2) return [`REVOKE_SESSION session ${addr(decodeAbiParameters([{ type: "address" }], data)[0])}`];
  if (action === 3) {
    const [m, daily, max] = decodeAbiParameters([{ type: "address" }, { type: "uint128" }, { type: "uint128" }], data);
    return [`SET_MERCHANT merchant ${addr(m)} · dailyCap ${usdt(daily)} · maxChannel ${usdt(max)}`];
  }
  if (action === 4) return [`REMOVE_MERCHANT merchant ${addr(decodeAbiParameters([{ type: "address" }], data)[0])}`];
  if (action === 5) {
    const [to, amount] = decodeAbiParameters([{ type: "address" }, { type: "uint256" }], data);
    return [`WITHDRAW to ${addr(to)} · amount ${usdt(amount)}`];
  }
  if (action === 6) return [`ROTATE_PQ_KEY newKeyHash ${decodeAbiParameters([{ type: "bytes32" }], data)[0].toLowerCase()}`];
  if (action === 7) return [`SET_VERIFIER verifier ${addr(decodeAbiParameters([{ type: "address" }], data)[0])}`];
  if (action === 8) {
    const [list] = decodeAbiParameters([{ type: "tuple[]", components: [{ type: "uint8", name: "a" }, { type: "bytes", name: "d" }] }], data);
    return list.flatMap((o) => ops(o.a, o.d));
  }
  return [`UNKNOWN action ${action} data ${data}`];
}

export function serverDecode(chainId: number, vault: string, change: { action: number; data: Hex; nonce: bigint | string; deadline: bigint | string }): string[] {
  return [`chain ${chainId} · vault ${addr(vault)} · nonce ${BigInt(change.nonce)} · deadline ${ts(BigInt(change.deadline))}`, ...ops(change.action, change.data)];
}
