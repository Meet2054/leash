import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { encodeFunctionData, getAddress, isAddress, keccak256, type Address, type Hex } from "viem";
import { EXPLORERS, leashFactoryAbi, leashVaultAbi, type OpenChannelRequest } from "@leash/sdk";
import { RelayerError } from "@leash/relayer";
import { findEvent } from "./engine.js";
import type { FacilitatorContext } from "./context.js";
import { computeStats } from "./stats.js";
import { PqLedger, pqSummary } from "./pqledger.js";

const ip = (c: Context) => c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? "local";

function fail(c: Context, e: unknown) {
  if (e instanceof RelayerError) return c.json({ error: e.code, message: e.message }, e.status as 400);
  return c.json({ error: "internal", message: e instanceof Error ? e.message : String(e) }, 500);
}

const toBig = (v: unknown) => BigInt(v as string);

/** Events the attestor (owner app) may publish to the audit log / HCS. F8.1 adds the Loosening* lifecycle. */
export const ATTESTOR_AUDIT_KINDS = ["ApprovalDenied", "ApprovalGranted", "ApprovalExpired", "ApprovalRequested", "LooseningPending", "LooseningBlocked", "LooseningCooldown", "LooseningCancelled"];

export function createApp(ctx: FacilitatorContext) {
  const app = new Hono();
  app.use("*", cors({ origin: "*", allowHeaders: ["Content-Type", "Authorization"], allowMethods: ["GET", "POST", "OPTIONS"] }));

  app.get("/health", (c) => c.json({ ok: true, network: ctx.network, relayer: ctx.relayer.address }));

  // ---------------------------------------------------------------- x402 facilitator API (v2)
  app.get("/supported", (c) => c.json(ctx.x402.getSupported()));

  app.post("/verify", async (c) => {
    const body = await c.req.json();
    try {
      return c.json(await ctx.x402.verify(body.paymentPayload, body.paymentRequirements));
    } catch (e) {
      return c.json({ isValid: false, invalidReason: "leash_verify_error", invalidMessage: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post("/settle", async (c) => {
    const body = await c.req.json();
    try {
      return c.json(await ctx.x402.settle(body.paymentPayload, body.paymentRequirements));
    } catch (e) {
      return c.json({
        success: false,
        errorReason: "leash_settle_error",
        errorMessage: e instanceof Error ? e.message : String(e),
        transaction: "",
        network: body?.paymentRequirements?.network ?? ctx.network,
      });
    }
  });

  // ---------------------------------------------------------------- channels (agent never pays gas)
  app.post("/channels/open", async (c) => {
    try {
      const body = (await c.req.json()) as OpenChannelRequest;
      return c.json(await ctx.engine.openChannel(body, ip(c)));
    } catch (e) {
      return fail(c, e);
    }
  });

  app.get("/channels", (c) => {
    const vault = c.req.query("vault");
    const rows = vault && isAddress(vault) ? ctx.store.channelsFor(vault, c.req.query("session"), c.req.query("merchant")) : ctx.store.allChannels();
    return c.json(rows.map((r) => ctx.engine.channelView(r)));
  });

  app.get("/channels/:id", (c) => {
    const row = ctx.store.channel(c.req.param("id"));
    return row ? c.json(ctx.engine.channelView(row)) : c.json({ error: "not_found" }, 404);
  });

  // ---------------------------------------------------------------- owner actions, relayed (owner never pays gas)
  app.post("/relay/createVault", async (c) => {
    try {
      const b = await c.req.json();
      const cfg = {
        pqPubKeyHash: b.cfg.pqPubKeyHash as Hex,
        worldSubjectHash: b.cfg.worldSubjectHash as Hex,
        verifier: b.cfg.verifier as Address,
        initialMandate: b.cfg.initialMandate as Hex,
      };
      const wa = parseWa(b.wa);
      const data = encodeFunctionData({ abi: leashFactoryAbi, functionName: "createVault", args: [cfg, b.pqPubKey, b.pqSig, wa, b.attestorSig] });
      const sent = await ctx.relayer.send({ to: ctx.cfg.deployment.factory, data, label: "createVault", budgetKeys: [`ip:${ip(c)}:create`] });
      const vault = await ctx.client.readContract({
        address: ctx.cfg.deployment.factory,
        abi: leashFactoryAbi,
        functionName: "predictVaultFor",
        args: [cfg.pqPubKeyHash, cfg.worldSubjectHash],
      });
      await ctx.audit.publish({ kind: "VaultCreated", chainId: ctx.cfg.chain.id, vault, tx: sent.hash, data: { worldSubjectHash: cfg.worldSubjectHash } });
      ctx.store.bump("pq_owner_actions");
      return c.json({ vault, txHash: sent.hash, explorerUrl: EXPLORERS[ctx.cfg.chain.id]?.tx(sent.hash), gasUsed: sent.receipt.gasUsed.toString() });
    } catch (e) {
      return fail(c, e);
    }
  });

  app.post("/relay/applyChange", async (c) => {
    try {
      const b = await c.req.json();
      const vault = getAddress(b.vault);
      if (!(await ctx.isLeashVault(vault))) throw new RelayerError("not_allowed", "not a Leash vault");
      const change = { action: Number(b.change.action), data: b.change.data as Hex, nonce: toBig(b.change.nonce), deadline: toBig(b.change.deadline) };
      const wa = parseWa(b.wa);
      const data = encodeFunctionData({
        abi: leashVaultAbi,
        functionName: "applyChange",
        args: [change, b.pqPubKey, b.pqSig, wa, (b.attestorSig ?? "0x") as Hex],
      });
      ctx.engine.breaker?.recordChangeAttempt(vault); // counted, never blocked: the owner may always change the mandate
      const sent = await ctx.relayer.send({ to: vault, data, label: "applyChange", budgetKeys: [`vault:${vault.toLowerCase()}:change`] });
      const ev = findEvent(sent.receipt, "MandateChanged");
      const args = (ev?.args ?? {}) as { loosening?: boolean; changeHash?: Hex };
      await ctx.audit.publish({
        kind: "MandateChanged",
        chainId: ctx.cfg.chain.id,
        vault,
        tx: sent.hash,
        data: { action: change.action, nonce: change.nonce.toString(), loosening: args.loosening, changeHash: args.changeHash, approvalId: b.approvalId },
      });
      ctx.store.bump("pq_owner_actions");
      return c.json({ txHash: sent.hash, explorerUrl: EXPLORERS[ctx.cfg.chain.id]?.tx(sent.hash), loosening: args.loosening, gasUsed: sent.receipt.gasUsed.toString() });
    } catch (e) {
      return fail(c, e);
    }
  });

  app.post("/relay/revokeSession", async (c) => {
    try {
      const b = await c.req.json();
      const vault = getAddress(b.vault);
      if (!(await ctx.isLeashVault(vault))) throw new RelayerError("not_allowed", "not a Leash vault");
      const data = encodeFunctionData({ abi: leashVaultAbi, functionName: "revokeSessionBySig", args: [getAddress(b.session), b.sig] });
      const sent = await ctx.relayer.send({ to: vault, data, label: "revokeSession", budgetKeys: [`vault:${vault.toLowerCase()}:change`] });
      await ctx.audit.publish({ kind: "SessionRevoked", chainId: ctx.cfg.chain.id, vault, tx: sent.hash, data: { session: b.session, by: "session" } });
      return c.json({ txHash: sent.hash, explorerUrl: EXPLORERS[ctx.cfg.chain.id]?.tx(sent.hash) });
    } catch (e) {
      return fail(c, e);
    }
  });

  /** Audit hook for decisions made off-chain (e.g. the attestor denying an approval). */
  app.post("/audit", async (c) => {
    if (ctx.cfg.adminToken && c.req.header("authorization") !== `Bearer ${ctx.cfg.adminToken}`) return c.json({ error: "unauthorized" }, 401);
    const b = await c.req.json();
    if (!ATTESTOR_AUDIT_KINDS.includes(b.kind)) return c.json({ error: "bad kind" }, 400);
    await ctx.audit.publish({ kind: b.kind, chainId: ctx.cfg.chain.id, vault: b.vault, data: b.data });
    return c.json({ ok: true });
  });

  // ---------------------------------------------------------------- discovery (x402 Bazaar-style listing)
  app.post("/discovery/register", async (c) => {
    const b = await c.req.json();
    for (const r of b.resources ?? []) {
      if (!r?.resource?.url || !Array.isArray(r.accepts)) continue;
      ctx.store.upsertResource({
        url: r.resource.url,
        method: r.method ?? "GET",
        merchant: r.accepts[0]?.payTo ?? "",
        description: r.resource.description,
        accepts: r.accepts,
        extensions: r.extensions,
      });
    }
    return c.json({ ok: true, count: ctx.store.resources().length });
  });

  app.get("/discovery/resources", (c) => {
    const all = ctx.store.resources();
    const limit = Number(c.req.query("limit") ?? 100);
    const offset = Number(c.req.query("offset") ?? 0);
    const items = all.slice(offset, offset + limit).map((r) => ({
      resource: r.url,
      type: "http",
      x402Version: 2,
      accepts: r.accepts,
      lastUpdated: new Date(r.updated * 1000).toISOString(),
      description: r.description ?? undefined,
      extensions: r.extensions,
      method: r.method,
    }));
    return c.json({ x402Version: 2, items, pagination: { limit, offset, total: all.length } });
  });

  // ---------------------------------------------------------------- F2 circuit breaker
  app.get("/breaker", async (c) => {
    const vault = c.req.query("vault");
    if (!vault || !isAddress(vault) || !ctx.engine.breaker) return c.json({ enabled: Boolean(ctx.engine.breaker) });
    const st = ctx.engine.breaker.status(getAddress(vault));
    // suggested tightening for the owner: revoke every session seen in the incident (PQ signature only, no World check)
    return c.json({ enabled: true, ...st, suggestion: st.state === "open" ? { kind: "REVOKE_SESSIONS", sessions: st.sessionsSeen } : null, config: ctx.engine.breaker.cfg });
  });
  app.post("/admin/breaker/reset", async (c) => {
    if (ctx.cfg.adminToken && c.req.header("authorization") !== `Bearer ${ctx.cfg.adminToken}`) return c.json({ error: "unauthorized" }, 401);
    const { vault } = await c.req.json();
    ctx.engine.breaker?.reset(vault);
    await ctx.audit.publish({ kind: "CircuitReset", chainId: ctx.cfg.chain.id, vault, data: { by: "admin" } });
    return c.json({ ok: true });
  });

  // ---------------------------------------------------------------- dashboard data
  app.get("/gas-tank", async (c) => c.json(await ctx.relayer.gasTank()));
  // F1: every tx where a Falcon (post-quantum) signature was verified onchain, with measured verify gas
  const ledger = new PqLedger(ctx.client, ctx.cfg.chain.id, ctx.cfg.deployment.factory, BigInt((ctx.cfg.deployment as { deployedAtBlock?: number }).deployedAtBlock ?? 0));
  app.get("/pq-ledger", async (c) => {
    try {
      const entries = await ledger.entries();
      return c.json({ entries, summary: pqSummary(entries, ctx.store.counter("vouchers_served")) });
    } catch (e) {
      return fail(c, e);
    }
  });
  app.get("/stats", async (c) => c.json(await computeStats(ctx)));
  app.get("/events", (c) => c.json(ctx.store.events(Number(c.req.query("limit") ?? 100), c.req.query("kind") ?? undefined)));
  app.get("/claims", (c) =>
    c.json(ctx.store.claims(Number(c.req.query("limit") ?? 100)).map((r) => ({ ...r, explorerUrl: EXPLORERS[r.chain_id]?.tx(r.tx) }))),
  );

  // ---------------------------------------------------------------- demo faucet (testnet only, DEMO_FAUCET=1)
  // Lets a judge or tester who just onboarded try the agent. The relayer sends a fixed amount of testnet USDT
  // to a verified Leash vault: once per vault, capped per day.
  app.post("/demo/faucet", async (c) => {
    if (process.env.DEMO_FAUCET !== "1") return c.json({ error: "disabled" }, 404);
    const b = (await c.req.json().catch(() => ({}))) as { vault?: string };
    if (!b.vault || !isAddress(b.vault)) return c.json({ error: "bad_vault" }, 400);
    const vault = getAddress(b.vault);
    if (!(await ctx.isLeashVault(vault))) return c.json({ error: "not_a_leash_vault", message: "Create your vault first." }, 400);
    const db = ctx.store.db;
    db.exec("CREATE TABLE IF NOT EXISTS faucet_grants (vault TEXT PRIMARY KEY, at INTEGER NOT NULL, tx TEXT)");
    const now = Math.floor(Date.now() / 1000);
    const used = (db.prepare("SELECT COUNT(*) AS n FROM faucet_grants WHERE at > ?").get(now - 86_400) as { n: number }).n;
    if (used >= Number(process.env.DEMO_FAUCET_DAILY ?? 15)) return c.json({ error: "faucet_daily_limit", message: "The demo faucet is empty for today." }, 429);
    const amount = BigInt(process.env.DEMO_FAUCET_AMOUNT ?? "2000000");
    // reserve first, so concurrent requests can't double-fund the same vault
    try {
      db.prepare("INSERT INTO faucet_grants (vault, at) VALUES (?, ?)").run(vault.toLowerCase(), now);
    } catch {
      return c.json({ error: "already_funded", message: "This vault already received demo USDT." }, 429);
    }
    try {
      const data = encodeFunctionData({ abi: [{ type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] }], functionName: "transfer", args: [vault, amount] });
      const r = await ctx.relayer.send({ to: ctx.cfg.deployment.token, data, label: "demoFaucet" });
      db.prepare("UPDATE faucet_grants SET tx = ? WHERE vault = ?").run(r.hash, vault.toLowerCase());
      await ctx.audit.publish({ kind: "DemoFaucet", chainId: ctx.cfg.chain.id, vault, amount: amount.toString(), tx: r.hash });
      return c.json({ tx: r.hash, amount: amount.toString(), explorerUrl: EXPLORERS[ctx.cfg.chain.id]?.tx(r.hash) });
    } catch (e) {
      db.prepare("DELETE FROM faucet_grants WHERE vault = ? AND tx IS NULL").run(vault.toLowerCase());
      return fail(c, e);
    }
  });

  app.post("/admin/batch", async (c) => {
    if (ctx.cfg.adminToken && c.req.header("authorization") !== `Bearer ${ctx.cfg.adminToken}`) return c.json({ error: "unauthorized" }, 401);
    const txs = await ctx.engine.runBatch(c.req.query("force") === "true");
    return c.json({ claims: txs.map((h) => ({ tx: h, explorerUrl: EXPLORERS[ctx.cfg.chain.id]?.tx(h) })) });
  });

  return app;
}

function parseWa(w: Record<string, string> | null | undefined) {
  const zero = "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex;
  if (!w) return { vault: "0x0000000000000000000000000000000000000000" as Address, changeHash: zero, nonce: 0n, worldSubjectHash: zero, authTime: 0n, deadline: 0n };
  return {
    vault: getAddress(w.vault),
    changeHash: w.changeHash as Hex,
    nonce: BigInt(w.nonce),
    worldSubjectHash: w.worldSubjectHash as Hex,
    authTime: BigInt(w.authTime),
    deadline: BigInt(w.deadline),
  };
}

export const _internal = { keccak256 };
