"use client";
import { bytesToHex, hexToBytes, type Hex } from "viem";
import type { OwnerSigner } from "./signer";

/** Tiny IndexedDB key/value store for the owner's Falcon seed (never leaves the browser). */
function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("leash", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("keys");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction("keys", mode);
      const req = fn(tx.objectStore("keys"));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    };
  });
}
const SEED_ID = "owner-falcon-seed";
const getSeed = () => idb<string | undefined>("readonly", (s) => s.get(SEED_ID) as IDBRequest<string | undefined>);
const putSeed = (hex: string) => idb("readwrite", (s) => s.put(hex, SEED_ID));

export type WasmSigner = OwnerSigner & { exportBackup(): Promise<string>; importBackup(json: string): Promise<void> };

/** In-browser ETHFALCON-512 key (WASM). Created on first use; back it up with exportBackup(). */
export function wasmSigner(): WasmSigner {
  let keyP: Promise<import("./falcon").FalconKey> | undefined;
  const load = () =>
    (keyP ??= (async () => {
      const { falconKeygen } = await import("./falcon");
      let seedHex = await getSeed();
      if (!seedHex) {
        seedHex = bytesToHex(crypto.getRandomValues(new Uint8Array(48)));
        await putSeed(seedHex);
      }
      return falconKeygen(hexToBytes(seedHex as Hex));
    })());
  return {
    kind: "wasm",
    label: "in-browser key (WASM, IndexedDB)",
    async pubKey() {
      return (await load()).pubKey;
    },
    async sign(digest) {
      const { falconSign } = await import("./falcon");
      return falconSign(await load(), digest);
    },
    async exportBackup() {
      const seed = await getSeed();
      return JSON.stringify({ scheme: "ETHFALCON-512", format: "zknox-nist16-seed", seed, pubKey: (await load()).pubKey }, null, 2);
    },
    async importBackup(json) {
      const j = JSON.parse(json);
      if (j.scheme !== "ETHFALCON-512" || typeof j.seed !== "string") throw new Error("not a Leash Falcon backup");
      await putSeed(j.seed);
      keyP = undefined;
    },
  };
}
