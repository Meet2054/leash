"use client";
import type { Hex } from "viem";

/** The owner's post-quantum (ETHFALCON-512) key. It signs 32-byte EIP-712 digests; it never pays gas. */
export interface OwnerSigner {
  kind: "wasm" | "localhost";
  label: string;
  pubKey(): Promise<Hex>;
  sign(digest: Hex, label?: string): Promise<Hex>;
  /** F8.3: passkey unlock for an encrypted in-browser key (call it from a click, before async work). */
  unlock?(): Promise<void>;
  locked?(): boolean;
}

/** Fallback (spec §9.1): ZKNox reference signer running on the owner's machine, bound to 127.0.0.1. */
export function localhostSigner(url: string): OwnerSigner {
  let cached: Hex | undefined;
  return {
    kind: "localhost",
    label: `local owner-signer (${url})`,
    async pubKey() {
      if (cached) return cached;
      const r = await fetch(`${url}/pubkey`);
      if (!r.ok) throw new Error("owner-signer not reachable");
      cached = (await r.json()).pubKey as Hex;
      return cached;
    },
    async sign(digest, label) {
      const r = await fetch(`${url}/sign`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ digest, label }) });
      if (!r.ok) throw new Error(`owner-signer: ${await r.text()}`);
      return (await r.json()).sig as Hex;
    },
  };
}
