"use client";
import { bytesToHex, hexToBytes, type Hex } from "viem";
import type { OwnerSigner } from "./signer";
import { credIdOf, isEncryptedSeed, openSeed, prfEval, registerPrfPasskey, saltOf, sealSeed, type EncryptedSeed } from "./passkey";

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
/** Stored record: a plain seed (hex string) or, after F8.3, a passkey-encrypted seed. */
type SeedRecord = string | EncryptedSeed;
const getRecord = () => idb<SeedRecord | undefined>("readonly", (s) => s.get(SEED_ID) as IDBRequest<SeedRecord | undefined>);
const putRecord = (r: SeedRecord) => idb("readwrite", (s) => s.put(r, SEED_ID));

const AUTO_LOCK_MS = 10 * 60 * 1000;

export type WasmSigner = OwnerSigner & {
  exportBackup(): Promise<string>;
  importBackup(json: string): Promise<void>;
  protection(): Promise<"none" | "passkey">;
  protectWithPasskey(): Promise<void>;
};

/** In-browser ETHFALCON-512 key (WASM). Created on first use; back it up with exportBackup(). */
export function wasmSigner(): WasmSigner {
  let keyP: Promise<import("./falcon").FalconKey> | undefined;
  let lockTimer: ReturnType<typeof setTimeout> | undefined;
  let unlocked = false;
  /** a passkey registered on a platform that needs a second ceremony (second tap) for its PRF secret */
  let pendingPasskey: { credId: Uint8Array; prfSalt: Uint8Array } | undefined;

  const seedOf = async (rec: SeedRecord | undefined): Promise<Uint8Array> => {
    if (rec === undefined) {
      const seed = crypto.getRandomValues(new Uint8Array(48));
      await putRecord(bytesToHex(seed));
      return seed;
    }
    if (typeof rec === "string") return hexToBytes(rec as Hex);
    // F8.3: passkey unlock (user verification), then auto-lock after a while
    const seed = await openSeed(rec, await prfEval(credIdOf(rec), saltOf(rec)));
    clearTimeout(lockTimer);
    lockTimer = setTimeout(() => {
      keyP = undefined;
      unlocked = false;
    }, AUTO_LOCK_MS);
    return seed;
  };
  const load = () =>
    (keyP ??= (async () => {
      const { falconKeygen } = await import("./falcon");
      const k = await falconKeygen(await seedOf(await getRecord()));
      unlocked = true;
      return k;
    })().catch((e) => {
      keyP = undefined; // a cancelled passkey prompt must not stick
      throw e;
    }));

  return {
    kind: "wasm",
    label: "in-browser key (WASM, IndexedDB)",
    async pubKey() {
      const rec = await getRecord();
      if (isEncryptedSeed(rec)) return rec.pubKey as Hex; // public: no unlock needed to display it
      return (await load()).pubKey;
    },
    async sign(digest) {
      const { falconSign } = await import("./falcon");
      return falconSign(await load(), digest);
    },
    async unlock() {
      await load();
    },
    locked() {
      return !unlocked;
    },
    async protection() {
      return isEncryptedSeed(await getRecord()) ? "passkey" : "none";
    },
    async protectWithPasskey() {
      // iOS/WebKit only opens the passkey sheet if the WebAuthn call starts right inside the tap, so it must be
      // the very first thing here: no IndexedDB read, WASM load or download before it.
      let ceremony: Promise<{ credId: Uint8Array; prfSalt: Uint8Array; prf?: Uint8Array }>;
      if (pendingPasskey) {
        const p = pendingPasskey;
        ceremony = prfEval(p.credId, p.prfSalt).then((prf) => ({ ...p, prf }));
      } else {
        const prfSalt = crypto.getRandomValues(new Uint8Array(32));
        ceremony = registerPrfPasskey(prfSalt).then((r) => ({ credId: r.credId, prfSalt, prf: r.prf }));
      }
      const got = await ceremony;
      if (!got.prf) {
        // this platform only gives the PRF secret on a second ceremony, which needs its own tap
        pendingPasskey = { credId: got.credId, prfSalt: got.prfSalt };
        throw Object.assign(new Error("Passkey created. Tap \"Add a passkey\" once more to finish."), { name: "PasskeyStep2" });
      }
      pendingPasskey = undefined;
      const { credId, prfSalt, prf } = got as { credId: Uint8Array; prfSalt: Uint8Array; prf: Uint8Array };
      const rec = await getRecord();
      if (isEncryptedSeed(rec)) return;
      const k = await load();
      const sealed = await sealSeed(k.seed, prf, { credId, prfSalt, pubKey: k.pubKey });
      // round-trip before replacing the plaintext record, so a bad PRF result can't lose the key
      const back = await openSeed(sealed, prf);
      if (bytesToHex(back) !== bytesToHex(k.seed)) throw new Error("passkey encryption round-trip failed; key left as it was");
      await putRecord(sealed);
    },
    async exportBackup() {
      const k = await load(); // unlocks with the passkey if the key is protected
      return JSON.stringify({ scheme: "ETHFALCON-512", format: "zknox-nist16-seed", seed: bytesToHex(k.seed), pubKey: k.pubKey }, null, 2);
    },
    async importBackup(json) {
      const j = JSON.parse(json);
      if (j.scheme !== "ETHFALCON-512" || typeof j.seed !== "string") throw new Error("not a Leash Falcon backup");
      await putRecord(j.seed); // imported keys start unprotected; protect again with a passkey
      keyP = undefined;
      unlocked = false;
    },
  };
}
