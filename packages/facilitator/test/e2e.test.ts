import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serve, type ServerType } from "@hono/node-server";
import { createPublicClient, createWalletClient, http, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { decodePaymentResponseHeader } from "@x402/core/http";
import {
  createSession,
  encode,
  encodeOps,
  initConfigDigest,
  wrapFetchWithLeash,
  worldApprovalDigest,
  leashFactoryAbi,
  leashVaultAbi,
  type LeashSession,
} from "@leash/sdk";
import { ANVIL_KEYS, freePort, startAnvil, type Anvil } from "@leash/relayer";
import { createMerchantApp, registerWithFacilitator } from "@leash/merchant";
import { createApp, createContext, type FacilitatorContext } from "../src/index.js";
import { anvilChain, deployLocal, mockUsdtAbi, type LocalDeployment } from "../src/devnet.js";

const ownerKey = "0x1111111111111111111111111111111111111111111111111111111111111111" as Hex; // MockPQ "PQ" key (local only)
const attestorKey = "0x2222222222222222222222222222222222222222222222222222222222222222" as Hex;
const merchants = {
  quote: "0x00000000000000000000000000000000000000a1",
  translate: "0x00000000000000000000000000000000000000a2",
  summarize: "0x00000000000000000000000000000000000000a3",
} as const satisfies Record<string, Address>;
const feeRecipient = "0x00000000000000000000000000000000000000fe" as Address;
const subject = "0x" + "ab".repeat(32) as Hex;

let anvil: Anvil;
let dep: LocalDeployment;
let ctx: FacilitatorContext;
let facSrv: ServerType;
let merSrv: ServerType;
let facUrl: string;
let merUrl: string;
let pub: PublicClient;
let vault: Address;
let session: LeashSession;

const listen = (app: { fetch: (r: Request) => Response | Promise<Response> }) =>
  new Promise<{ srv: ServerType; url: string }>((resolve) => {
    const srv = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, (info) => resolve({ srv, url: `http://127.0.0.1:${info.port}` }));
  });

beforeAll(async () => {
  anvil = await startAnvil();
  const owner = privateKeyToAccount(ownerKey);
  const attestor = privateKeyToAccount(attestorKey);
  dep = await deployLocal({ rpcUrl: anvil.url, deployerKey: ANVIL_KEYS[0], attestor: attestor.address, feeRecipient });
  const chain = anvilChain(anvil.url);
  pub = createPublicClient({ chain, transport: http(anvil.url) });

  // facilitator (the relayer is the deployer key)
  const port = await freePort();
  facUrl = `http://127.0.0.1:${port}`;
  ctx = createContext({
    chain,
    rpcUrl: anvil.url,
    relayerKey: ANVIL_KEYS[0],
    deployment: { ...dep, ethFalconVerifier: dep.verifier },
    publicUrl: facUrl,
    gasFloorGwei: "1",
    pollingIntervalMs: 50,
    minChannel: 1_000_000n,
  });
  facSrv = await new Promise<ServerType>((resolve) => {
    const s = serve({ fetch: createApp(ctx).fetch, port, hostname: "127.0.0.1" }, () => resolve(s));
  });

  // owner creates a vault: counterfactual deposit, PQ-signed InitConfig, World approval, relayed (no gas)
  session = createSession();
  const now = BigInt(Math.floor(Date.now() / 1000));
  const ops = [
    encode.setMerchant(merchants.quote, 50_000_000n, 5_000_000n),
    encode.setMerchant(merchants.translate, 50_000_000n, 5_000_000n),
    encode.setMerchant(merchants.summarize, 50_000_000n, 5_000_000n),
    encode.addSession(session.address, now + 86_400n, 20_000_000n),
  ];
  const ownerPub = owner.address as Hex; // MockPQVerifier: pubkey = 20-byte address
  const pqPubKeyHash = (await import("viem")).keccak256(ownerPub);
  const cfg = { pqPubKeyHash, worldSubjectHash: subject, verifier: dep.verifier, initialMandate: encodeOps(ops) };
  vault = await pub.readContract({ address: dep.factory, abi: leashFactoryAbi, functionName: "predictVaultFor", args: [pqPubKeyHash, subject] });
  const deployer = createWalletClient({ chain, transport: http(anvil.url), account: privateKeyToAccount(ANVIL_KEYS[1]) });
  await pub.waitForTransactionReceipt({
    hash: await deployer.writeContract({ address: dep.token, abi: mockUsdtAbi, functionName: "mint", args: [vault, 100_000_000n] }),
  });
  const initDigest = initConfigDigest(31337, dep.factory, cfg);
  const wa = { vault, changeHash: initDigest, nonce: 0n, worldSubjectHash: subject, authTime: now, deadline: now + 600n };
  const res = await fetch(`${facUrl}/relay/createVault`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(
      {
        cfg,
        pqPubKey: ownerPub,
        pqSig: await owner.sign({ hash: initDigest }),
        wa,
        attestorSig: await attestor.sign({ hash: worldApprovalDigest(31337, dep.factory, wa) }),
      },
      (_k, v) => (typeof v === "bigint" ? v.toString() : v),
    ),
  });
  expect(res.status).toBe(200);

  // merchant
  const merchantCfg = {
    facilitatorUrl: facUrl,
    publicUrl: "",
    network: "eip155:31337" as const,
    payTo: merchants,
    asset: { asset: dep.token, decimals: 6, symbol: "USDT" },
  };
  const { app } = createMerchantApp(merchantCfg);
  const mer = await listen(app);
  merSrv = mer.srv;
  merUrl = mer.url;
  await registerWithFacilitator({ ...merchantCfg, publicUrl: merUrl });
}, 60_000);

afterAll(() => {
  merSrv?.close();
  facSrv?.close();
  anvil?.stop();
});

describe("end to end on anvil: agent pays 30 requests, batcher claims", () => {
  it("vault was created by the relayer and holds the counterfactual deposit", async () => {
    const code = await pub.getCode({ address: vault });
    expect(code?.length).toBeGreaterThan(2);
    expect(await pub.readContract({ address: dep.token, abi: mockUsdtAbi, functionName: "balanceOf", args: [vault] })).toBe(100_000_000n);
  });

  it("agent discovers endpoints, pays per request without gas, batcher settles in few claims", async () => {
    // discovery: the agent finds endpoints instead of hard-coding them
    const disc = (await (await fetch(`${facUrl}/discovery/resources`)).json()) as { items: { resource: string }[] };
    expect(disc.items.map((i) => new URL(i.resource).pathname).sort()).toEqual(["/quote", "/summarize", "/translate"]);
    const urls = disc.items.map((i) => i.resource);

    const events: string[] = [];
    const { fetch: paidFetch } = wrapFetchWithLeash(fetch, {
      session,
      vault,
      networks: ["eip155:31337"],
      channelAmount: () => 2_000_000n,
      onEvent: (e) => events.push(e.type),
    });

    let ok = 0;
    for (let i = 0; i < 30; i++) {
      const r = await paidFetch(urls[i % 3]);
      expect(r.status).toBe(200);
      const pr = r.headers.get("PAYMENT-RESPONSE");
      expect(pr).toBeTruthy();
      expect(decodePaymentResponseHeader(pr!).success).toBe(true);
      ok++;
    }
    expect(ok).toBe(30);
    expect(events.filter((e) => e === "channel_opened").length).toBe(3);
    expect(ctx.store.counter("vouchers_served")).toBe(30);

    // the session key never held gas
    expect(await pub.getBalance({ address: session.address })).toBe(0n);

    const claims = await ctx.engine.runBatch(true);
    expect(claims.length).toBe(3); // 30 payments → 3 claim txs

    // prices: quote 0.01, translate 0.02, summarize 0.05 — 10 calls each
    const bal = (a: Address) => pub.readContract({ address: dep.token, abi: mockUsdtAbi, functionName: "balanceOf", args: [a] });
    expect(await bal(merchants.quote)).toBe(100_000n - 1000n);
    expect(await bal(merchants.translate)).toBe(200_000n - 1000n);
    expect(await bal(merchants.summarize)).toBe(500_000n - 1000n);
    expect(await bal(feeRecipient)).toBe(3000n);

    const stats = (await (await fetch(`${facUrl}/stats`)).json()) as { live: { vouchersServed: number; claimTxs: number; txReductionFactor: number } };
    expect(stats.live.vouchersServed).toBe(30);
    expect(stats.live.claimTxs).toBe(3);
    expect(stats.live.txReductionFactor).toBe(10);
  }, 60_000);

  it("replaying a payment header does not buy a second response", async () => {
    const { fetch: paidFetch } = wrapFetchWithLeash(fetch, { session, vault, networks: ["eip155:31337"], channelAmount: () => 2_000_000n });
    const first = await fetch(`${merUrl}/quote`); // 402
    expect(first.status).toBe(402);
    // capture a valid paid request's signature header via a manual flow
    let captured: string | null = null;
    const spy: typeof fetch = async (input, init) => {
      // x402 fetch passes Request objects (possibly from another realm): duck-type on .headers
      const reqHeaders = typeof input === "object" && "headers" in input ? (input as Request).headers : undefined;
      const h = new Headers(reqHeaders);
      new Headers(init?.headers).forEach((v, k) => h.set(k, v));
      if (h.get("PAYMENT-SIGNATURE")) captured = h.get("PAYMENT-SIGNATURE");
      return fetch(input, init);
    };
    const { fetch: spyFetch } = wrapFetchWithLeash(spy, { session, vault, networks: ["eip155:31337"], channelAmount: () => 2_000_000n });
    expect((await spyFetch(`${merUrl}/quote`)).status).toBe(200);
    expect(captured).toBeTruthy();
    const replay = await fetch(`${merUrl}/quote`, { headers: { "PAYMENT-SIGNATURE": captured! } });
    expect(replay.status).toBe(402);
    void paidFetch;
  }, 30_000);

  it("a voucher signed by a different key is rejected", async () => {
    const thief = createSession();
    const { fetch: thiefFetch } = wrapFetchWithLeash(fetch, { session: thief, vault, networks: ["eip155:31337"], channelAmount: () => 2_000_000n });
    await expect(thiefFetch(`${merUrl}/quote`)).rejects.toThrow(/open channel failed|UnknownSession/);
  }, 30_000);

  it("after the owner revokes the session, new vouchers are refused", async () => {
    const owner = privateKeyToAccount(ownerKey);
    const nonce = await pub.readContract({ address: vault, abi: leashVaultAbi, functionName: "mandateNonce" });
    const op = encode.revokeSession(session.address);
    const change = { action: op.action, data: op.data, nonce, deadline: BigInt(Math.floor(Date.now() / 1000) + 600) };
    const { mandateChangeDigest } = await import("@leash/sdk");
    const res = await fetch(`${facUrl}/relay/applyChange`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        { vault, change, pqPubKey: owner.address, pqSig: await owner.sign({ hash: mandateChangeDigest(31337, vault, change) }), wa: null, attestorSig: "0x" },
        (_k, v) => (typeof v === "bigint" ? v.toString() : v),
      ),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).loosening).toBe(false);
    await new Promise((r) => setTimeout(r, 2100)); // session cache TTL
    const { fetch: paidFetch } = wrapFetchWithLeash(fetch, { session, vault, networks: ["eip155:31337"], channelAmount: () => 2_000_000n });
    const r = await paidFetch(`${merUrl}/translate`);
    expect(r.status).toBe(402);
  }, 30_000);
});
