import { describe, expect, it } from "vitest";
import { aesKeyFromPrf, isEncryptedSeed, openSeed, sealSeed } from "../lib/client/passkey";

const rnd = (n: number) => crypto.getRandomValues(new Uint8Array(n));
const meta = () => ({ credId: rnd(16), prfSalt: rnd(32), pubKey: "0x" + "11".repeat(1024) });

describe("F8.3 passkey-encrypted Falcon seed (crypto part; WebAuthn itself needs a browser)", () => {
  it("seals and opens with the same PRF output", async () => {
    const seed = rnd(48);
    const prf = rnd(32);
    const rec = await sealSeed(seed, prf, meta());
    expect(isEncryptedSeed(rec)).toBe(true);
    expect(rec.ct).not.toContain(Buffer.from(seed).toString("hex"));
    expect(await openSeed(rec, prf)).toEqual(seed);
  });
  it("a different passkey (PRF output) cannot open it", async () => {
    const rec = await sealSeed(rnd(48), rnd(32), meta());
    await expect(openSeed(rec, rnd(32))).rejects.toThrow(/did not unlock/);
  });
  it("tampered ciphertext is rejected (AES-GCM tag)", async () => {
    const prf = rnd(32);
    const rec = await sealSeed(rnd(48), prf, meta());
    const flipped = { ...rec, ct: (rec.ct[0] === "0" ? "1" : "0") + rec.ct.slice(1) };
    await expect(openSeed(flipped, prf)).rejects.toThrow();
  });
  it("derived AES key is non-extractable", async () => {
    const k = await aesKeyFromPrf(rnd(32));
    expect(k.extractable).toBe(false);
    expect(k.algorithm).toMatchObject({ name: "AES-GCM", length: 256 });
  });
  it("plain hex seeds (pre-F8.3) are recognised as unprotected", () => {
    expect(isEncryptedSeed("0x" + "ab".repeat(48))).toBe(false);
  });
});
