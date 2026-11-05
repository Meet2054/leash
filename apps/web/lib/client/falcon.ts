/**
 * In-browser ETHFALCON-512 owner key (gate M5). ZKNox's NIST Falcon C code compiled to WASM with
 * -DETHFALCON (keccak hash-to-point, matches ZKNOX_ethfalcon onchain) and a crypto.getRandomValues RNG.
 * Build: tools/falcon-wasm/build.sh. Output encodings match contracts/src/verifiers/EthFalconVerifier.sol:
 *   pubKey = NTT(h) as 512 × 16-bit coefficients compacted 16 per 256-bit word (1,024 B)
 *   sig    = salt (40 B) || s2 compacted the same way (1,024 B)
 */
import { bytesToHex, hexToBytes, type Hex } from "viem";
import createEthFalcon from "./ethfalcon-wasm.mjs";

const PK_LEN = 1025;
const SK_LEN = 1281;
const NONCE_LEN = 40;
const N = 512;

type Module = {
  HEAPU8: Uint8Array;
  HEAPU32: Uint32Array;
  _malloc(n: number): number;
  _free(p: number): void;
  _zknox_crypto_sign_keypair_from_seed(pk: number, sk: number, seed: number, seedLen: number): number;
  _zknox_crypto_sign(sm: number, smlen: number, m: number, mlen: bigint, sk: number): number;
  _zknox_crypto_sign_open(m: number, mlen: number, sm: number, smlen: bigint, pk: number): number;
};

let modP: Promise<Module> | undefined;
const mod = () => (modP ??= createEthFalcon() as Promise<Module>);

/** 512 big-endian uint16 coefficients → 32 words, coefficient i at bits 16·(i mod 16) of word ⌊i/16⌋. */
export function compact16(be: Uint8Array): Uint8Array {
  if (be.length !== 2 * N) throw new Error(`expected ${2 * N} bytes, got ${be.length}`);
  const out = new Uint8Array(32 * 32);
  for (let w = 0; w < 32; w++) {
    let word = 0n;
    for (let k = 0; k < 16; k++) {
      const i = w * 16 + k;
      const c = (be[2 * i] << 8) | be[2 * i + 1];
      if (c >= 12289) throw new Error("coefficient out of range");
      word |= BigInt(c) << BigInt(16 * k);
    }
    for (let b = 0; b < 32; b++) out[w * 32 + b] = Number((word >> BigInt(8 * (31 - b))) & 0xffn);
  }
  return out;
}

function withMem<T>(f: Module, sizes: number[], fn: (ptrs: number[]) => T): T {
  const ptrs = sizes.map((s) => f._malloc(s));
  try {
    return fn(ptrs);
  } finally {
    ptrs.forEach((p, i) => (f.HEAPU8.fill(0, p, p + sizes[i]), f._free(p)));
  }
}

export type FalconKey = { seed: Uint8Array; sk: Uint8Array; pkRaw: Uint8Array; pubKey: Hex };

/** Deterministic keypair from a ≥32-byte seed (back up the seed to back up the key). */
export async function falconKeygen(seed: Uint8Array = globalThis.crypto.getRandomValues(new Uint8Array(48))): Promise<FalconKey> {
  const f = await mod();
  return withMem(f, [PK_LEN, SK_LEN, seed.length], ([pk, sk, sp]) => {
    f.HEAPU8.set(seed, sp);
    if (f._zknox_crypto_sign_keypair_from_seed(pk, sk, sp, seed.length) !== 0) throw new Error("Falcon keygen failed");
    const pkRaw = f.HEAPU8.slice(pk, pk + PK_LEN);
    if (pkRaw[0] !== 9) throw new Error("unexpected public key header");
    return { seed, sk: f.HEAPU8.slice(sk, sk + SK_LEN), pkRaw, pubKey: bytesToHex(compact16(pkRaw.subarray(1))) };
  });
}

/** Sign a 32-byte digest; returns salt || compact(s2) for EthFalconVerifier. Self-verifies before returning. */
export async function falconSign(key: Pick<FalconKey, "sk" | "pkRaw">, digest: Hex): Promise<Hex> {
  const f = await mod();
  const msg = hexToBytes(digest);
  if (msg.length !== 32) throw new Error("digest must be 32 bytes");
  const smMax = 2 + NONCE_LEN + msg.length + 1 + 2 * N + 64;
  return withMem(f, [smMax, 8, msg.length, SK_LEN, PK_LEN, smMax, 8], ([sm, smlen, mp, skp, pkp, out, outlen]) => {
    f.HEAPU8.set(msg, mp);
    f.HEAPU8.set(key.sk, skp);
    f.HEAPU8.set(key.pkRaw, pkp);
    if (f._zknox_crypto_sign(sm, smlen, mp, BigInt(msg.length), skp) !== 0) throw new Error("Falcon sign failed");
    const len = f.HEAPU32[smlen >> 2];
    if (f._zknox_crypto_sign_open(out, outlen, sm, BigInt(len), pkp) !== 0) throw new Error("Falcon self-verify failed");
    const bytes = f.HEAPU8.slice(sm, sm + len);
    const sigLen = (bytes[0] << 8) | bytes[1];
    const salt = bytes.subarray(2, 2 + NONCE_LEN);
    const esig = bytes.subarray(2 + NONCE_LEN + msg.length, 2 + NONCE_LEN + msg.length + sigLen);
    if (esig[0] !== 0x29 || esig.length !== 1 + 2 * N) throw new Error(`unexpected signature encoding (len ${esig.length})`);
    const out2 = new Uint8Array(NONCE_LEN + 1024);
    out2.set(salt, 0);
    out2.set(compact16(esig.subarray(1)), NONCE_LEN);
    return bytesToHex(out2);
  });
}
