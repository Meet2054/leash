import { describe, expect, it } from "vitest";
import { canonicalChange, encode } from "@leash/sdk";
import { serverDecode } from "../lib/server/decode";

const V = "0x3B77877490A4C2A89e55b94e969cae1fA190c392" as const;
const S = "0x2215D4d6b0cceac3be59340142d4Cc9fE4E22D3B" as const;
const M = "0x00000000000000000000000000000000000000b2" as const;
const ops = {
  addSession: encode.addSession(S, 1_800_000_000n, 5_000_000n),
  setSessionLimits: encode.setSessionLimits(S, 0n, 8_000_001n),
  revokeSession: encode.revokeSession(S),
  setMerchant: encode.setMerchant(M, 10_000_000n, 1_000_000n),
  removeMerchant: encode.removeMerchant(M),
  withdraw: encode.withdraw(S, 6_500_000n),
  rotate: encode.rotatePqKey(`0x${"ab".repeat(32)}`),
  verifier: encode.setVerifier(M),
};
const change = (op: { action: number; data: `0x${string}` }) => ({ ...op, nonce: 7n, deadline: 1_800_000_600n });

describe("F8.2 independent decoding", () => {
  for (const [name, op] of Object.entries(ops)) {
    it(`server and client decoders agree: ${name}`, () => {
      expect(serverDecode(1874, V, change(op))).toEqual(canonicalChange(1874, V, change(op)));
    });
  }
  it("agree on BATCH (flattened, one line per op)", () => {
    const b = encode.batch([ops.addSession, ops.setMerchant, ops.withdraw]);
    const lines = serverDecode(1874, V, change(b));
    expect(lines).toEqual(canonicalChange(1874, V, change(b)));
    expect(lines).toHaveLength(4);
  });
  it("a swapped payload shows up as a mismatch", () => {
    const shown = canonicalChange(1874, V, change(encode.withdraw(S, 6_500_000n)));
    const fed = serverDecode(1874, V, change(encode.withdraw(M, 6_500_000n)));
    expect(fed).not.toEqual(shown);
  });
  it("amounts render atomically and in USDT", () => {
    expect(serverDecode(1874, V, change(ops.withdraw))[1]).toBe(`WITHDRAW to ${S.toLowerCase()} · amount 6500000 (6.500000 USDT)`);
  });
});
