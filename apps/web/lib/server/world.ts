import "server-only";
import { SignJWT, createLocalJWKSet, createRemoteJWKSet, exportJWK, generateKeyPair, jwtVerify, type JWK, type JWTPayload } from "jose";
import { keccak256, toBytes, type Hex } from "viem";
import { WORLD } from "./env";
import { db, now } from "./db";

/**
 * World ID Agent Pass = the World IdP (auth.world.org). We use the OAuth 2.0 Device Authorization Grant
 * (RFC 8628) from this backend: the device_code never leaves the server, the owner approves on their
 * phone, and only a validated ID token (fresh auth_time, proof of personhood) makes the attestor sign.
 * The IdP has no binding_message, so the action binding lives in our attempt record (single use).
 * Details: docs/research/world-idp.md
 */

export type DeviceStart = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
};

export type PollResult =
  | { state: "pending"; slowDown?: boolean }
  | { state: "approved"; idToken: string }
  | { state: "denied"; reason: string }
  | { state: "expired"; reason: string }
  | { state: "error"; reason: string };

export type ValidatedIdentity = { sub: string; subjectString: string; subjectHash: Hex; authTime: number; acr?: string; amr: string[]; jti?: string; mocked: boolean };

const basicAuth = () => "Basic " + Buffer.from(`${encodeURIComponent(WORLD.clientId)}:${encodeURIComponent(WORLD.clientSecret)}`).toString("base64");

/** World subject → onchain worldSubjectHash. Pairwise `sub` is per client, so include the issuer. */
export function subjectStringOf(issuer: string, sub: string, mocked: boolean): string {
  return mocked ? WORLD.mockSubject : `${issuer}#${sub}`;
}
export const subjectHashOf = (s: string): Hex => keccak256(toBytes(s));

// ------------------------------------------------------------------------------------------- real World IdP

export async function startDeviceAuth(pinnedSub?: string): Promise<DeviceStart> {
  const claims: Record<string, unknown> = {};
  if (WORLD.requestAcr.length) claims.acr = { essential: true, values: WORLD.requestAcr };
  if (pinnedSub) claims.sub = { value: pinnedSub };
  const body = new URLSearchParams({ scope: "openid" });
  if (Object.keys(claims).length) body.set("claims", JSON.stringify({ id_token: claims }));
  const r = await fetch(`${WORLD.issuer}/api/v1/device_authorization`, {
    method: "POST",
    headers: { authorization: basicAuth(), "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const j = (await r.json()) as Record<string, unknown>;
  if (!r.ok) throw new Error(`World device_authorization failed: ${j.error ?? r.status} ${j.error_description ?? ""}`);
  return {
    deviceCode: String(j.device_code),
    userCode: String(j.user_code),
    verificationUri: String(j.verification_uri),
    verificationUriComplete: String(j.verification_uri_complete ?? j.verification_uri),
    expiresIn: Number(j.expires_in ?? 1200),
    interval: Number(j.interval ?? 5),
  };
}

export async function pollDeviceToken(deviceCode: string): Promise<PollResult> {
  let r: Response;
  try {
    r = await fetch(`${WORLD.issuer}/api/v1/token`, {
      method: "POST",
      headers: { authorization: basicAuth(), "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: deviceCode }),
    });
  } catch {
    return { state: "pending" }; // network blip: back off and retry
  }
  if (r.status === 503) return { state: "error", reason: "World IdP temporarily unavailable" };
  if (r.status === 429) return { state: "error", reason: "rate limited by World IdP" };
  const j = (await r.json().catch(() => ({}))) as Record<string, string>;
  if (r.ok && j.id_token) return { state: "approved", idToken: j.id_token };
  switch (j.error) {
    case "authorization_pending":
      return { state: "pending" };
    case "slow_down":
      return { state: "pending", slowDown: true };
    case "access_denied":
      return { state: "denied", reason: j.error_description ?? "the user denied the request" };
    case "expired_token":
      return { state: "expired", reason: "the World request expired" };
    default:
      return { state: "error", reason: `${j.error ?? r.status} ${j.error_description ?? ""}`.trim() };
  }
}

const remoteJwks = () => createRemoteJWKSet(new URL(`${WORLD.issuer}/.well-known/jwks.json`));

// ------------------------------------------------------------------------------------------- MOCKED issuer

type MockKeys = { privateKey: CryptoKey; jwk: JWK };
const g = globalThis as unknown as { __leashMockKeys?: Promise<MockKeys> };
function mockKeys(): Promise<MockKeys> {
  g.__leashMockKeys ??= (async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
    const jwk = { ...(await exportJWK(publicKey)), kid: "leash-mock-1", alg: "RS256", use: "sig" };
    return { privateKey: privateKey as CryptoKey, jwk };
  })();
  return g.__leashMockKeys;
}
export async function mockJwks() {
  return { keys: [(await mockKeys()).jwk] };
}

/** MOCKED: mint an ID token as if the owner completed World verification just now (offline demo only). */
export async function mintMockIdToken(attemptId: string): Promise<string> {
  const { privateKey } = await mockKeys();
  return new SignJWT({ auth_time: now(), acr: "https://world.org/oidc/acr/orb-face", amr: ["pop", "face", "user"], attempt: attemptId })
    .setProtectedHeader({ alg: "RS256", kid: "leash-mock-1" })
    .setIssuer(WORLD.mockIssuer)
    .setAudience("leash-mock-client")
    .setSubject("mock-owner")
    .setIssuedAt()
    .setExpirationTime("5m")
    .setJti(crypto.randomUUID())
    .sign(privateKey);
}

// ------------------------------------------------------------------------------------------- validation

/**
 * Validate an ID token for one attempt. Never trust a client-supplied result: the token comes straight
 * from the IdP's token endpoint (or the mock issuer) to this server.
 */
export async function validateIdToken(idToken: string, attempt: { started_at: number }, mocked: boolean): Promise<ValidatedIdentity> {
  const issuer = mocked ? WORLD.mockIssuer : WORLD.issuer;
  const { payload } = await jwtVerify(idToken, mocked ? createLocalJWKSet(await mockJwks()) : remoteJwks(), {
    issuer,
    audience: mocked ? "leash-mock-client" : WORLD.clientId,
    algorithms: ["RS256"],
    clockTolerance: 5,
  });
  const p = payload as JWTPayload & { auth_time?: number; acr?: string; amr?: string[] };
  if (!p.sub) throw new Error("ID token has no sub");
  if (typeof p.auth_time !== "number") throw new Error("ID token has no auth_time");
  // freshness: the human authenticated during THIS attempt, not earlier
  if (p.auth_time < attempt.started_at - 5) throw new Error(`stale authentication (auth_time ${p.auth_time} < attempt start ${attempt.started_at})`);
  const amr = Array.isArray(p.amr) ? p.amr : [];
  if (WORLD.requirePop && !amr.includes("pop")) throw new Error(`no fresh proof of personhood (amr=${JSON.stringify(amr)})`);
  if (WORLD.acceptedAcr.length && (!p.acr || !WORLD.acceptedAcr.includes(p.acr))) throw new Error(`assurance level ${p.acr} not accepted`);
  if (p.jti) {
    const seen = db().prepare("SELECT id FROM attempts WHERE jti = ?").get(p.jti);
    if (seen) throw new Error("ID token replayed (jti already used)");
  }
  const subjectString = subjectStringOf(issuer, p.sub, mocked);
  return { sub: p.sub, subjectString, subjectHash: subjectHashOf(subjectString), authTime: p.auth_time, acr: p.acr, amr, jti: p.jti, mocked };
}
