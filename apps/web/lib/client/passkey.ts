/**
 * F8.3: the owner's Falcon seed at rest, encrypted with a key derived from a passkey (WebAuthn PRF).
 *   PRF(credential, salt) ─HKDF-SHA256(info="leash/owner-falcon-seed/v1")→ AES-256-GCM key → encrypt(seed)
 * The seed only exists in memory after a passkey unlock (user verification). The PRF output never leaves
 * the authenticator/browser, and nothing is sent to any server. If the passkey is lost, the exported
 * backup is the only way back, so the UI downloads one before protecting.
 * Limitation: needs a browser + authenticator with the WebAuthn PRF extension (Chrome/Edge 116+ with
 * platform or security-key passkeys, Safari 18+); otherwise the seed stays unencrypted in IndexedDB.
 */

export type EncryptedSeed = {
  v: 1;
  enc: "passkey-prf";
  credId: string; // base64url
  prfSalt: string; // hex, 32 B
  iv: string; // hex, 12 B
  ct: string; // hex, AES-GCM(seed) incl. tag
  pubKey: string; // public, so the app can show the key without unlocking
  createdAt: number;
};

const INFO = new TextEncoder().encode("leash/owner-falcon-seed/v1");
const AAD = new TextEncoder().encode("leash-falcon-seed-v1");
const subtle = () => globalThis.crypto.subtle;

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (h: string) => new Uint8Array((h.replace(/^0x/, "").match(/../g) ?? []).map((x) => parseInt(x, 16)));
const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const buf = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

/** HKDF-SHA256(PRF output) → AES-256-GCM key (non-extractable). */
export async function aesKeyFromPrf(prf: Uint8Array): Promise<CryptoKey> {
  const ikm = await subtle().importKey("raw", buf(prf), "HKDF", false, ["deriveKey"]);
  return subtle().deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: INFO }, ikm, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function sealSeed(seed: Uint8Array, prf: Uint8Array, meta: { credId: Uint8Array; prfSalt: Uint8Array; pubKey: string }): Promise<EncryptedSeed> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv, additionalData: AAD }, await aesKeyFromPrf(prf), buf(seed)));
  return { v: 1, enc: "passkey-prf", credId: b64url(meta.credId), prfSalt: hex(meta.prfSalt), iv: hex(iv), ct: hex(ct), pubKey: meta.pubKey, createdAt: Math.floor(Date.now() / 1000) };
}

export async function openSeed(rec: EncryptedSeed, prf: Uint8Array): Promise<Uint8Array> {
  try {
    return new Uint8Array(await subtle().decrypt({ name: "AES-GCM", iv: unhex(rec.iv), additionalData: AAD }, await aesKeyFromPrf(prf), buf(unhex(rec.ct))));
  } catch {
    throw new Error("passkey did not unlock this key (wrong passkey or corrupted record)");
  }
}

export const isEncryptedSeed = (x: unknown): x is EncryptedSeed => typeof x === "object" && x !== null && (x as EncryptedSeed).enc === "passkey-prf";

// ------------------------------------------------------------------ WebAuthn (browser only)

type PrfResults = { enabled?: boolean; results?: { first?: ArrayBuffer } };
const prfOf = (c: PublicKeyCredential) => (c.getClientExtensionResults() as { prf?: PrfResults }).prf;

/** true / false when the browser can tell, "unknown" otherwise (we then just try). */
export async function prfSupport(): Promise<boolean | "unknown"> {
  if (typeof window === "undefined" || !window.PublicKeyCredential) return false;
  const caps = await (PublicKeyCredential as unknown as { getClientCapabilities?: () => Promise<Record<string, boolean>> }).getClientCapabilities?.().catch(() => undefined);
  if (caps && "extension:prf" in caps) return Boolean(caps["extension:prf"]);
  return "unknown";
}

/** Evaluate the PRF of an existing passkey (prompts the user: biometrics / PIN). */
export async function prfEval(credId: Uint8Array, salt: Uint8Array): Promise<Uint8Array> {
  const c = (await navigator.credentials.get({
    publicKey: {
      challenge: globalThis.crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ type: "public-key", id: buf(credId) }],
      userVerification: "required",
      timeout: 60_000,
      extensions: { prf: { eval: { first: buf(salt) } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  const out = c && prfOf(c)?.results?.first;
  if (!out) throw new Error("this passkey/browser does not support the WebAuthn PRF extension");
  return new Uint8Array(out);
}

/** Create a passkey with PRF enabled and return its id + the PRF output for `salt`. */
/**
 * Registration only: returns the PRF output if the platform gives it at creation (Safari 18+, iCloud Keychain),
 * otherwise just the credential. The caller decides when to run the second ceremony, because iOS/WebKit only
 * opens a passkey sheet when the WebAuthn call starts right inside a tap.
 */
export async function registerPrfPasskey(salt: Uint8Array): Promise<{ credId: Uint8Array; prf?: Uint8Array }> {
  const c = (await navigator.credentials.create({
    publicKey: {
      challenge: globalThis.crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: "Leash owner key" },
      user: { id: globalThis.crypto.getRandomValues(new Uint8Array(16)), name: "leash-owner", displayName: "Leash owner (Falcon key unlock)" },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
      timeout: 60_000,
      extensions: { prf: { eval: { first: buf(salt) } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!c) throw new Error("passkey creation cancelled");
  const p = prfOf(c);
  if (p?.enabled === false) throw new Error("this passkey/browser does not support the WebAuthn PRF extension; the key stays unencrypted (see README limitations)");
  return { credId: new Uint8Array(c.rawId), prf: p?.results?.first ? new Uint8Array(p.results.first) : undefined };
}

/** Plain-language text for WebAuthn failures (NotAllowedError is what iOS shows when a prompt is blocked). */
export function passkeyErrorText(e: unknown): string {
  const name = (e as { name?: string })?.name;
  const msg = e instanceof Error ? e.message : String(e);
  const inApp = typeof navigator !== "undefined" && /GSA\/|FBAN|FBAV|Instagram|LinkedInApp|Line\/|Snapchat|Twitter|WhatsApp/i.test(navigator.userAgent);
  if (name === "NotAllowedError")
    return inApp
      ? "This app's built-in browser blocked the passkey. Open permissionless.in in Safari or Chrome, or tap \"Continue without a passkey\" and keep the backup file."
      : "The passkey prompt was closed or blocked. Tap \"Protect with passkey\" again. If it keeps failing, open the site in Safari or Chrome, or continue without a passkey and keep the backup file.";
  if (name === "NotSupportedError" || /PRF/i.test(msg)) return "This browser or passkey can't encrypt the key (it needs the WebAuthn PRF feature). Continue without a passkey and keep the backup file.";
  if (name === "InvalidStateError") return "A passkey for this already exists on this device. Tap \"Protect with passkey\" again.";
  return msg;
}

/** True inside in-app browsers (Google app, Instagram, …), where passkeys are often blocked. */
export const inAppBrowser = () => typeof navigator !== "undefined" && /GSA\/|FBAN|FBAV|Instagram|LinkedInApp|Line\/|Snapchat|Twitter|WhatsApp/i.test(navigator.userAgent);

export async function createPrfPasskey(salt: Uint8Array): Promise<{ credId: Uint8Array; prf: Uint8Array }> {
  const c = (await navigator.credentials.create({
    publicKey: {
      challenge: globalThis.crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: "Leash owner key" },
      user: { id: globalThis.crypto.getRandomValues(new Uint8Array(16)), name: "leash-owner", displayName: "Leash owner (Falcon key unlock)" },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
      timeout: 60_000,
      extensions: { prf: { eval: { first: buf(salt) } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!c) throw new Error("passkey creation cancelled");
  const credId = new Uint8Array(c.rawId);
  const p = prfOf(c);
  if (p?.enabled === false) throw new Error("this passkey/browser does not support the WebAuthn PRF extension; the key stays unencrypted (see README limitations)");
  // some authenticators only return PRF results on get(), not at creation
  const prf = p?.results?.first ? new Uint8Array(p.results.first) : await prfEval(credId, salt);
  return { credId, prf };
}

export const credIdOf = (rec: EncryptedSeed) => unb64url(rec.credId);
export const saltOf = (rec: EncryptedSeed) => unhex(rec.prfSalt);
