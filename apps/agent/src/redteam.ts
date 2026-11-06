/**
 * Protocol-level red team against the LIVE Leash deployment (no AI in the loop): races, replays, forged
 * amounts, oversized channels, wrong signers, cross-chain replay, self-approval. Each attack prints
 * HELD (refused/bounded) or BROKEN. Uses an authorized session on the given vault; spends at most what the
 * mandate allows (the race test is the only one that pays).
 *   tsx --env-file=../../.env src/redteam.ts <vault> [sessionKeyFile]
 */
import { readFileSync } from "node:fs";
import { getAddress, type Address, type Hex } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { createSession, encode, leashDomain, leashTypes, leashVaultAbi, parseUnits6, signOpenChannel, signVoucher, wrapFetchWithLeash, type LeashSession } from "@leash/sdk";
import { publicClient } from "./lib/config.js";

const FAC = "https://facilitator.permissionless.in";
const WEB = "https://permissionless.in";
const MER = "https://merchant.permissionless.in";
const CHAIN = 1874;
const vault = getAddress(process.argv[2]);
const keyFile = process.argv[3] ?? new URL("../../../keys/agent-session-demo.json", import.meta.url).pathname;
const session = createSession(JSON.parse(readFileSync(keyFile, "utf8")).privateKey as Hex);
const QUOTE = "0x3425bC52cd7f10F1221eF2708321b4b0924d431D" as Address;
const results: { attack: string; verdict: "HELD" | "BROKEN"; detail: string }[] = [];
const record = (attack: string, held: boolean, detail: string) => {
  results.push({ attack, verdict: held ? "HELD" : "BROKEN", detail });
  console.log(`${held ? "✓ HELD  " : "✕ BROKEN"} ${attack}: ${detail}`);
};
const post = async (url: string, body: unknown) => {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)) });
  const t = await r.text();
  return { status: r.status, text: t };
};
const sess = async (s: Address) => publicClient.readContract({ address: vault, abi: leashVaultAbi, functionName: "sessions", args: [s] });
const reason = (t: string) => t.match(/simulation_reverted: (\w+)/)?.[1] ?? t.match(/"error":"(\w+)"/)?.[1] ?? t.slice(0, 120);

async function openReq(s: LeashSession, over: Partial<{ merchant: Address; amount: bigint; expiry: bigint; chainId: number }> = {}) {
  const [expiry] = await sess(s.address).catch(() => [0n]);
  const now = BigInt(Math.floor(Date.now() / 1000));
  const req = { vault, merchant: over.merchant ?? QUOTE, amount: over.amount ?? parseUnits6("1"), expiry: over.expiry ?? (expiry && expiry < now + 3600n ? expiry : now + 3600n), sessionNonce: now * 1000n + BigInt(Math.floor(Math.random() * 999)) };
  const sig = await signOpenChannel(s, over.chainId ?? CHAIN, req);
  return post(`${FAC}/channels/open`, { chainId: over.chainId ?? CHAIN, request: req, sig });
}

const main = async () => {
  const [expiry, revoked, cap, locked0, spent0] = await sess(session.address);
  console.log(`vault ${vault} · session ${session.address} · cap ${cap} locked ${locked0} spent ${spent0} expiry ${expiry} revoked ${revoked}\n`);

  // 1. oversized channel (> maxChannel 1 USDT)
  let r = await openReq(session, { amount: parseUnits6("2") });
  record("Open a 2 USDT channel (max per channel is 1)", r.status !== 200, `${r.status} ${reason(r.text)}`);

  // 2. channel to a non-allowed merchant
  r = await openReq(session, { merchant: "0x000000000000000000000000000000000000dEaD" });
  record("Open a channel to an outsider (0x…dEaD)", r.status !== 200, `${r.status} ${reason(r.text)}`);

  // 3. channel that outlives the session
  r = await openReq(session, { expiry: expiry + 86_400n });
  record("Open a channel that outlives the session", r.status !== 200, `${r.status} ${reason(r.text)}`);

  // 4. unauthorized signer (fresh key the owner never added)
  r = await openReq(createSession(generatePrivateKey()));
  record("Open a channel signed by an unauthorized key", r.status !== 200, `${r.status} ${reason(r.text)}`);

  // 5. cross-chain replay: signature made for another chain id
  r = await openReq(session, { chainId: 1 });
  record("Replay a channel open signed for another chain (id 1)", r.status !== 200, `${r.status} ${reason(r.text)}`);

  // 6. session key tries to change its own cap (no owner PQ key, no World approval)
  const nonce = await publicClient.readContract({ address: vault, abi: leashVaultAbi, functionName: "mandateNonce" });
  const op = encode.setSessionLimits(session.address, expiry, parseUnits6("500"));
  const change = { action: op.action, data: op.data, nonce, deadline: BigInt(Math.floor(Date.now() / 1000) + 600) };
  const msig = await session.account.signTypedData({ domain: leashDomain(CHAIN, vault), types: { MandateChange: leashTypes.MandateChange }, primaryType: "MandateChange", message: change });
  r = await post(`${FAC}/relay/applyChange`, { vault, change, pqPubKey: session.address, pqSig: msig, wa: null, attestorSig: "0x" });
  record("Session key sets its own cap to 500", r.status !== 200, `${r.status} ${reason(r.text)}`);

  // 7. same, plus a forged World approval signed by the agent itself (pretending to be the attestor)
  const wa = { vault, changeHash: "0x" + "11".repeat(32), nonce, worldSubjectHash: "0x" + "22".repeat(32), authTime: BigInt(Math.floor(Date.now() / 1000)), deadline: BigInt(Math.floor(Date.now() / 1000) + 600) };
  const fakeAtt = await session.account.signTypedData({ domain: leashDomain(CHAIN, vault), types: { WorldApproval: leashTypes.WorldApproval }, primaryType: "WorldApproval", message: wa as never });
  r = await post(`${FAC}/relay/applyChange`, { vault, change, pqPubKey: session.address, pqSig: msig, wa, attestorSig: fakeAtt });
  record("Session key + self-forged World approval", r.status !== 200, `${r.status} ${reason(r.text)}`);

  // 8. agent files a request, then tries to push it through the owner's approval endpoints itself
  const req = await post(`${WEB}/api/approvals`, { vault, op, reason: "red team: self-approval attempt" });
  const id = (() => { try { return JSON.parse(req.text).id as string; } catch { return ""; } })();
  r = await post(`${WEB}/api/approvals/${id}/submit`, { pqPubKey: "0x" + "00".repeat(1024), pqSig: "0x" + "00".repeat(1064) });
  record("Agent submits its own request without World + owner key", r.status !== 200, `${r.status} ${r.text.slice(0, 100)}`);
  if (id) await post(`${WEB}/api/approvals/${id}/deny`, {});

  // 9. race: 12 parallel clients (independent local state) hammer the same merchant
  const before = await sess(session.address);
  const clients = Array.from({ length: 12 }, () => wrapFetchWithLeash(fetch, { session, vault, networks: [`eip155:${CHAIN}`], sessionExpiry: expiry, channelAmount: () => parseUnits6("1") }).fetch);
  const outs = await Promise.allSettled(clients.flatMap((f) => Array.from({ length: 5 }, (_, i) => f(`${MER}/quote?pair=USD/INR&i=${i}`).then((x) => x.status))));
  const ok = outs.filter((o) => o.status === "fulfilled" && o.value === 200).length;
  const after = await sess(session.address);
  const committed = BigInt(after[3]) + BigInt(after[4]);
  record(`Race: 60 parallel paid calls from 12 independent clients`, committed <= BigInt(cap), `${ok} paid · locked+spent ${committed} ≤ cap ${cap} (before ${BigInt(before[3]) + BigInt(before[4])})`);

  // 10. forged voucher above the channel's lock, and a replayed (non-increasing) voucher, sent to /verify
  const chans = (await (await fetch(`${FAC}/channels?vault=${vault}&session=${session.address}&merchant=${QUOTE}`)).json()) as { channelId: Hex; locked: string; lastAccepted: string; status: string }[];
  const ch = chans.find((c) => c.status === "open");
  if (ch) {
    const reqs = (await (await fetch(`${FAC}/discovery/resources`)).json()) as { items: { resource: string; accepts: Record<string, unknown>[] }[] };
    const accepts = reqs.items.find((x) => new URL(x.resource).pathname === "/quote" && x.accepts[0].network === `eip155:${CHAIN}`)!.accepts[0];
    const mk = async (cum: bigint) => ({
      x402Version: 2,
      accepted: accepts,
      payload: { vault, session: session.address, channelId: ch.channelId, cumulativeAmount: cum.toString(), voucherSig: await signVoucher(session, CHAIN, vault, { channelId: ch.channelId, cumulativeAmount: cum }) },
    });
    const control = await post(`${FAC}/verify`, { x402Version: 2, paymentPayload: await mk(BigInt(ch.lastAccepted) + BigInt(accepts.amount as string)), paymentRequirements: accepts });
    console.log(`  (control: a correct next voucher → ${control.text.slice(0, 80)})`);
    const over = await post(`${FAC}/verify`, { x402Version: 2, paymentPayload: await mk(BigInt(ch.locked) + 1n), paymentRequirements: accepts });
    const controlOk = /"isValid":true/.test(control.text);
    if (!controlOk) record("Voucher forgery tests", false, `INCONCLUSIVE: a correct voucher was not accepted either (${control.text.slice(0, 100)})`);
    record("Voucher above the channel's locked amount", controlOk && !/"isValid":true/.test(over.text), over.text.slice(0, 120));
    const replay = await post(`${FAC}/verify`, { x402Version: 2, paymentPayload: await mk(BigInt(ch.lastAccepted)), paymentRequirements: accepts });
    record("Replay of an already-paid voucher (no increase)", controlOk && !/"isValid":true/.test(replay.text), replay.text.slice(0, 120));
  } else record("Voucher forgery tests", true, "skipped: no open channel");

  const broken = results.filter((x) => x.verdict === "BROKEN").length;
  console.log(`\n${results.length - broken}/${results.length} attacks held${broken ? ` · ${broken} BROKEN` : ""}`);
  console.log(JSON.stringify(results));
};
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
