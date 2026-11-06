/**
 * F8.1 live smoke test against a running owner app (attestor) + facilitator on Whitechain.
 * Run the app with WORLD_MODE=mock POLICY_COOLDOWN_SEC=25 POLICY_WITHDRAW_COOLDOWN_ABOVE=0 and a scratch WEB_DB.
 *   1. R1: a session-cap raise above 2× is refused before any World check
 *   2. R3: withdrawal → World passes → COOLDOWN → owner presses Deny → cancelled, nothing signed
 *   3. R3: withdrawal → COOLDOWN → a PQ-signed tightening lands (nonce bump) → cancelled
 *   4. R3: withdrawal → COOLDOWN elapses → WorldApproval signed; then Deny → submit refused (409)
 * Usage: pnpm --filter @leash/agent exec tsx --env-file=../../.env src/f8-smoke.ts
 */
import { getAddress, type Hex } from "viem";
import { encode, leashVaultAbi, mandateChangeDigest } from "@leash/sdk";
import { ensureOwnerKey, falconSign } from "./lib/falcon.js";
import {
  CHAIN_ID,
  FACILITATOR_URL,
  INBOX_URL,
  agentSession,
  loadVault,
  nowSec,
  post,
  publicClient,
} from "./lib/config.js";

type At = {
  status: string;
  reason: string | null;
  cooldownUntil?: number | null;
  worldApproval: unknown;
  effects: unknown;
};
const web = async <T>(
  path: string,
  body?: unknown,
): Promise<{ status: number; body: T }> => {
  const r = await fetch(
    `${INBOX_URL}${path}`,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  return { status: r.status, body: (await r.json()) as T };
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const v = loadVault();
const s = agentSession();
let failures = 0;
const check = (name: string, cond: boolean, detail: unknown) => {
  console.log(
    `${cond ? "✓" : "✕"} ${name}${cond ? "" : ` — ${JSON.stringify(detail)}`}`,
  );
  if (!cond) failures++;
};

async function file(op: { action: number; data: Hex }, reason: string) {
  const r = await web<{ id: string }>(`/api/approvals`, {
    vault: v.vault,
    op,
    reason,
  });
  if (r.status !== 200)
    throw new Error(`file approval → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.id;
}
async function startAndPass(id: string) {
  const st = await web<{ attemptId: string; error?: string }>(
    `/api/approvals/${id}/start`,
    {},
  );
  if (st.status !== 200)
    return { error: st.body.error ?? JSON.stringify(st.body) };
  await web(`/api/world/mock/${st.body.attemptId}`, { decision: "approve" });
  return { attemptId: st.body.attemptId };
}
const poll = async (attemptId: string) =>
  (await web<At>(`/api/world/attempts/${attemptId}`)).body;

const main = async () => {
  const [expiry, , cap] = await publicClient.readContract({
    address: v.vault,
    abi: leashVaultAbi,
    functionName: "sessions",
    args: [s.address],
  });
  console.log(
    `vault ${v.vault} · session ${s.address} cap ${cap} · attestor ${INBOX_URL}`,
  );
  const small = encode.withdraw(getAddress(s.address), 10_000n); // 0.01 USDT; never submitted

  // 1. R1
  const big = await file(
    encode.setSessionLimits(s.address, expiry, cap * 3n),
    "F8 smoke: 3× raise",
  );
  const r1 = await startAndPass(big);
  check(
    "R1: 3× cap raise refused before the World check",
    "error" in r1 && /R1/.test(String(r1.error)),
    r1,
  );

  // 2. cooldown → Deny
  const a2 = await startAndPass(
    await file(small, "F8 smoke: deny during cooldown"),
  );
  if (!("attemptId" in a2)) throw new Error(String(a2.error));
  let at = await poll(a2.attemptId!);
  check(
    "R3: withdrawal enters COOLDOWN after the World check",
    at.status === "COOLDOWN" && !at.worldApproval,
    at,
  );
  const appr2 = (
    await web<{ id: string; status: string }[]>(
      `/api/approvals?vault=${v.vault}`,
    )
  ).body.find((x) => x.status === "APPROVING")!;
  await web(`/api/approvals/${appr2.id}/deny`, {});
  at = await poll(a2.attemptId!);
  check(
    "R3: owner Deny during the cooldown cancels it (nothing signed)",
    at.status === "DENIED" && !at.worldApproval,
    at,
  );

  // 3. cooldown → PQ-signed tightening bumps the nonce (costs one PQ tx; SKIP_TX=1 skips it)
  if (!process.env.SKIP_TX) {
    const id3 = await file(small, "F8 smoke: tightening during cooldown");
    const a3 = await startAndPass(id3);
    if (!("attemptId" in a3)) throw new Error(String(a3.error));
    at = await poll(a3.attemptId!);
    check("R3: second withdrawal in COOLDOWN", at.status === "COOLDOWN", at);
    const op = encode.setSessionLimits(s.address, expiry, cap); // same limits → not a loosening → PQ only
    const loosening = await publicClient.readContract({
      address: v.vault,
      abi: leashVaultAbi,
      functionName: "isLoosening",
      args: [op.action, op.data],
    });
    if (loosening) throw new Error("no-op change classified as loosening");
    const nonce = await publicClient.readContract({
      address: v.vault,
      abi: leashVaultAbi,
      functionName: "mandateNonce",
    });
    const change = {
      action: op.action,
      data: op.data,
      nonce,
      deadline: nowSec() + 600n,
    };
    const k = ensureOwnerKey();
    const t = await post<{ txHash: Hex }>(
      `${FACILITATOR_URL}/relay/applyChange`,
      {
        vault: v.vault,
        change,
        pqPubKey: k.pubKey,
        pqSig: falconSign(mandateChangeDigest(CHAIN_ID, v.vault, change)),
        wa: null,
        attestorSig: "0x",
      },
    );
    console.log(`  PQ-only tightening tx ${t.txHash}`);
    for (let i = 0; i < 10 && at.status === "COOLDOWN"; i++) {
      await sleep(1500);
      at = await poll(a3.attemptId!);
    }
    check(
      "R3: a PQ-signed change during the cooldown cancels it",
      at.status === "DENIED" &&
        /stale/.test(at.reason ?? "") &&
        !at.worldApproval,
      at,
    );
  }

  // 4. cooldown elapses → signed; then Deny → submit refused
  const id4 = await file(small, "F8 smoke: cooldown elapses");
  const a4 = await startAndPass(id4);
  if (!("attemptId" in a4)) throw new Error(String(a4.error));
  at = await poll(a4.attemptId!);
  const until = at.cooldownUntil ?? 0;
  console.log(
    `  waiting out the cooldown (until ${new Date(until * 1000).toISOString()})…`,
  );
  while (at.status === "COOLDOWN") {
    await sleep(2000);
    at = await poll(a4.attemptId!);
  }
  check(
    "R3: after the cooldown the attestor signs the WorldApproval",
    at.status === "APPROVED" &&
      Boolean(at.worldApproval) &&
      Math.floor(Date.now() / 1000) >= until,
    at,
  );
  await web(`/api/approvals/${id4}/deny`, {});
  const sub = await web<{ error?: string }>(`/api/approvals/${id4}/submit`, {
    pqPubKey: ensureOwnerKey().pubKey,
    pqSig: "0x00",
  });
  check(
    "submit is refused once the owner denied (even with a signed WorldApproval)",
    sub.status === 409,
    sub,
  );

  console.log(
    failures
      ? `\n${failures} check(s) FAILED`
      : "\nall F8.1 live checks passed",
  );
  process.exit(failures ? 1 : 0);
};
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
