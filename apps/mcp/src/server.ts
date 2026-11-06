/**
 * Leash MCP server: any MCP-capable AI agent (Claude Desktop, Claude Code, Cursor, …) can pay x402 APIs from
 * a Leash vault, and can try to break its own limits. The limits are enforced by the vault contract and the
 * Leash facilitator, never by this server or the agent's prompt: every tool here is a real call whose
 * refusals come back verbatim.
 *
 * Env:
 *   LEASH_VAULT            vault address the owner created at https://permissionless.in (required for paying)
 *   LEASH_AGENT_KEY_FILE   session key file (default ~/.leash/agent-key.json; created on first run, 0600)
 *   LEASH_WEB_URL          owner app + approvals inbox (default https://permissionless.in)
 *   LEASH_FACILITATOR_URL  x402 facilitator (default https://facilitator.permissionless.in)
 *   LEASH_API_KEY          optional partner-lane key (x-api-key)
 * The session key never holds gas and is bounded by the owner's mandate; it never leaves this machine.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getAddress, isAddress, type Address, type Hex } from "viem";
import { generatePrivateKey } from "viem/accounts";
import {
  createSession,
  encode,
  formatUnits6,
  getLooseningStatus,
  leashDomain,
  leashTypes,
  parseUnits6,
  requestLoosening,
  signOpenChannel,
  wrapFetchWithLeash,
  type LeashSession,
} from "@leash/sdk";

const CHAIN_ID = 1874;
const WEB = (process.env.LEASH_WEB_URL ?? "https://permissionless.in").replace(/\/$/, "");
const FAC = (process.env.LEASH_FACILITATOR_URL ?? "https://facilitator.permissionless.in").replace(/\/$/, "");
const API_KEY = process.env.LEASH_API_KEY || undefined;
const KEY_FILE = process.env.LEASH_AGENT_KEY_FILE ?? join(homedir(), ".leash", "agent-key.json");
const LOG_FILE = join(dirname(KEY_FILE), "agent-log.jsonl");
const VAULT: Address | null = process.env.LEASH_VAULT && isAddress(process.env.LEASH_VAULT) ? getAddress(process.env.LEASH_VAULT) : null;

// ------------------------------------------------------------------ session key (created once, stays local)

function loadSession(): LeashSession {
  if (!existsSync(KEY_FILE)) {
    mkdirSync(dirname(KEY_FILE), { recursive: true });
    writeFileSync(KEY_FILE, JSON.stringify({ privateKey: generatePrivateKey(), createdAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
  }
  return createSession(JSON.parse(readFileSync(KEY_FILE, "utf8")).privateKey as Hex);
}
const session = loadSession();

function log(tool: string, args: unknown, outcome: unknown) {
  try {
    appendFileSync(LOG_FILE, JSON.stringify({ at: new Date().toISOString(), agent: session.address, vault: VAULT, tool, args, outcome }) + "\n");
  } catch {
    /* logging must never break a tool */
  }
  console.error(`[leash] ${tool} → ${typeof outcome === "string" ? outcome : JSON.stringify(outcome).slice(0, 300)}`);
}

// ------------------------------------------------------------------ helpers

type SessionView = { address: string; expiry: string; revoked: boolean; cap: string; locked: string; spent: string };
type VaultView = { deployed: boolean; balance: string; free?: string; locked?: string; nonce?: string; sessions?: SessionView[]; merchants?: { address: string; allowed: boolean; dailyCap: string; spentToday: string; maxChannel: string }[] };
type Resource = { resource: string; description?: string; accepts: { scheme: string; network: string; amount: string; payTo: string }[] };

async function getJson<T>(url: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const r = await fetch(url, init);
  const text = await r.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: r.status, body: body as T };
}

async function vaultView(): Promise<VaultView> {
  if (!VAULT) throw new Error("LEASH_VAULT is not set: ask the owner for their vault address");
  const { status, body } = await getJson<VaultView>(`${WEB}/api/vault/${VAULT}`);
  if (status !== 200) throw new Error(`could not read the vault (HTTP ${status})`);
  return body;
}
const mySession = (v: VaultView) => v.sessions?.find((s) => s.address.toLowerCase() === session.address.toLowerCase());
const usd = (atomic: string | bigint) => `${formatUnits6(BigInt(atomic))} USDT`;

/** Plain refusal text; the raw Leash reason stays in parentheses. */
function refusal(raw: string): string {
  const m = raw.match(/simulation_reverted: (\w+)/)?.[1] ?? raw.match(/"error":"(\w+)"/)?.[1] ?? raw.match(/\b(leash_[a-z_]+)\b/)?.[1] ?? "";
  const why: Record<string, string> = {
    MerchantNotAllowed: "that address is not on the owner's merchant allow list",
    WrongPqKey: "only the owner's post-quantum key can change limits; an agent's session key cannot",
    ExceedsSessionCap: "that would go over the agent's spending cap",
    ExceedsMerchantDailyCap: "that would go over the merchant's daily cap",
    ExceedsMaxChannel: "that's more than the owner allows per payment channel",
    BadExpiry: "the session expires too soon to open a payment channel",
    SessionIsRevoked: "the owner froze (revoked) this agent",
    SessionExpired: "this agent's session has expired",
    UnknownSession: "this agent isn't authorized on the vault",
    InsufficientBalance: "the vault doesn't have enough free USDT",
    leash_circuit_open: "spending is paused by the circuit breaker",
    leash_rate_limited: "too many payments too fast",
    leash_session_revoked_or_expired: "this agent was revoked or its session expired",
    leash_exceeds_locked: "the payment channel is used up",
  };
  return why[m] ? `${why[m]} (${m})` : raw.slice(0, 400);
}
const decodeHeader = (h: string | null) => {
  if (!h) return null;
  try {
    return JSON.parse(Buffer.from(h, "base64").toString("utf8"));
  } catch {
    return null;
  }
};
const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

let paidFetch: { fetch: typeof fetch; expiry: bigint } | null = null;
function payingFetch(expiry: bigint) {
  if (!paidFetch || paidFetch.expiry !== expiry) {
    paidFetch = {
      expiry,
      fetch: wrapFetchWithLeash(fetch, {
        session,
        vault: VAULT!,
        networks: [`eip155:${CHAIN_ID}`],
        sessionExpiry: expiry,
        apiKey: API_KEY,
        channelAmount: () => parseUnits6("1"),
        onEvent: (e) => e.type === "channel_opened" && console.error(`[leash] channel opened ${e.txHash}`),
      }).fetch,
    };
  }
  return paidFetch.fetch;
}

async function services(): Promise<Resource[]> {
  const { body } = await getJson<{ items: Resource[] }>(`${FAC}/discovery/resources`);
  return (body.items ?? []).filter((r) => r.accepts[0]?.network === `eip155:${CHAIN_ID}`);
}

// ------------------------------------------------------------------ server + tools

const server = new McpServer({ name: "leash", version: "0.1.0" });

server.registerTool(
  "leash_whoami",
  { title: "Who am I (Leash agent identity)", description: "Shows this agent's Leash session address, which vault it spends from, and whether the owner has authorized it yet.", inputSchema: {} },
  async () => {
    let status = "LEASH_VAULT is not set.";
    if (VAULT) {
      try {
        const s = mySession(await vaultView());
        status = !s ? "Not authorized yet: the owner must add this address in the Leash app (Limits → Add an agent)." : s.revoked ? "Revoked (frozen) by the owner." : Number(s.expiry) * 1000 < Date.now() ? "Session expired." : `Authorized: cap ${usd(s.cap)}, valid until ${new Date(Number(s.expiry) * 1000).toISOString()}.`;
      } catch (e) {
        status = e instanceof Error ? e.message : String(e);
      }
    }
    const out = `Agent session address: ${session.address}\nVault: ${VAULT ?? "(not set)"}\nStatus: ${status}\nOwner app: ${WEB}\nThis key never holds gas. Every limit is enforced by the vault contract, not by this tool.`;
    log("leash_whoami", {}, status);
    return text(out);
  },
);

server.registerTool(
  "check_budget",
  { title: "Check spending budget", description: "How much this agent may still spend, until when, and which merchants it may pay.", inputSchema: {} },
  async () => {
    try {
      const v = await vaultView();
      const s = mySession(v);
      if (!s) return text(`This agent (${session.address}) is not authorized on vault ${VAULT}. The owner must add it in the Leash app.`);
      const left = BigInt(s.cap) - BigInt(s.spent) - BigInt(s.locked);
      const out = [
        `Cap ${usd(s.cap)} · spent ${usd(s.spent)} · reserved in open channels ${usd(s.locked)} · can still commit ${usd(left > 0n ? left : 0n)}`,
        `Valid until ${new Date(Number(s.expiry) * 1000).toISOString()}${s.revoked ? " · REVOKED" : ""}`,
        `Vault holds ${usd(v.balance)} (free ${usd(v.free ?? "0")})`,
        `Allowed merchants: ${(v.merchants ?? []).filter((m) => m.allowed).map((m) => `${m.address} (daily ${usd(m.dailyCap)})`).join(", ") || "none"}`,
      ].join("\n");
      log("check_budget", {}, out);
      return text(out);
    } catch (e) {
      return text(e instanceof Error ? e.message : String(e));
    }
  },
);

server.registerTool(
  "list_services",
  { title: "List paid APIs", description: "Lists the x402-paid APIs this agent can buy from, with prices in USDT.", inputSchema: {} },
  async () => {
    const items = await services();
    const out = items.map((r) => `${new URL(r.resource).pathname.slice(1)} — ${usd(r.accepts[0].amount)} per call — ${r.description ?? ""} (${r.resource})`).join("\n") || "No services discovered.";
    log("list_services", {}, `${items.length} services`);
    return text(out);
  },
);

server.registerTool(
  "buy_service",
  {
    title: "Buy one API call",
    description: "Pays for and calls one paid API (x402, USDT on Whitechain) from the owner's vault. Examples: service 'quote' with params {pair:'USD/INR'}; 'translate' with {text:'hello', to:'hi'}; 'summarize' with {text:'…'}.",
    inputSchema: { service: z.string().describe("Service name (quote, translate, summarize) or its full URL"), params: z.record(z.string()).optional().describe("Query parameters") },
  },
  async ({ service, params }) => {
    try {
      const v = await vaultView();
      const s = mySession(v);
      if (!s) return text(`Refused before paying: this agent isn't authorized on the vault yet (${session.address}).`);
      const items = await services();
      const r = items.find((x) => x.resource === service || new URL(x.resource).pathname.slice(1) === service.replace(/^\//, ""));
      if (!r) return text(`Unknown service "${service}". Available: ${items.map((x) => new URL(x.resource).pathname.slice(1)).join(", ")}`);
      const u = new URL(r.resource);
      for (const [k, val] of Object.entries(params ?? {})) u.searchParams.set(k, val);
      let res: Response;
      try {
        res = await payingFetch(BigInt(s.expiry))(u.toString());
      } catch (e) {
        const why = refusal(e instanceof Error ? e.message : String(e));
        log("buy_service", { service, params }, `refused: ${why}`);
        return text(`Payment refused by Leash: ${why}. Nothing was paid.`);
      }
      if (res.status !== 200) {
        const req = decodeHeader(res.headers.get("PAYMENT-REQUIRED"));
        const why = refusal(req?.error ?? `HTTP ${res.status}`);
        log("buy_service", { service, params }, `refused: ${why}`);
        return text(`Payment refused by Leash: ${why}. Nothing was paid.`);
      }
      const pr = decodeHeader(res.headers.get("PAYMENT-RESPONSE"));
      const body = (await res.text()).slice(0, 2000);
      const out = `Paid ${usd(r.accepts[0].amount)} to ${r.accepts[0].payTo} (running total on this channel: ${pr?.extra?.cumulativeAmount ? usd(pr.extra.cumulativeAmount) : "?"}).\nResponse: ${body}`;
      log("buy_service", { service, params }, { paid: r.accepts[0].amount, cumulative: pr?.extra?.cumulativeAmount });
      return text(out);
    } catch (e) {
      return text(e instanceof Error ? e.message : String(e));
    }
  },
);

server.registerTool(
  "request_more_budget",
  {
    title: "Ask the owner for a higher cap",
    description: "Files a request in the owner's Leash approvals inbox to raise this agent's spending cap. The owner decides (World ID + their own key); this tool cannot approve anything.",
    inputSchema: { new_cap_usdt: z.string().describe("Requested total cap in USDT, e.g. '7.5'"), reason: z.string().describe("Why the agent needs it") },
  },
  async ({ new_cap_usdt, reason }) => {
    try {
      const v = await vaultView();
      const s = mySession(v);
      if (!s) return text("This agent isn't authorized on the vault, so it can't file requests.");
      const op = encode.setSessionLimits(session.address, BigInt(s.expiry), parseUnits6(new_cap_usdt));
      const r = await requestLoosening({ inboxUrl: WEB, session, vault: VAULT!, op, reason: reason.slice(0, 500) });
      log("request_more_budget", { new_cap_usdt, reason }, r);
      return text(`Request ${r.id} filed (${r.status}). The owner sees it in their Requests tab and decides with World ID. Check it later with check_request.`);
    } catch (e) {
      return text(`Could not file the request: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
);

server.registerTool(
  "check_request",
  { title: "Check a budget request", description: "Shows whether the owner approved, denied, or hasn't decided a budget request yet.", inputSchema: { id: z.string() } },
  async ({ id }) => {
    try {
      const r = await getLooseningStatus(WEB, id);
      log("check_request", { id }, r);
      return text(JSON.stringify(r, null, 2));
    } catch (e) {
      return text(e instanceof Error ? e.message : String(e));
    }
  },
);

server.registerTool(
  "change_my_limits",
  {
    title: "Change my own spending cap directly",
    description: "Attempts to change this agent's spending cap directly, by signing a mandate change with the agent's own session key and submitting it to the vault.",
    inputSchema: { new_cap_usdt: z.string() },
  },
  async ({ new_cap_usdt }) => {
    try {
      const v = await vaultView();
      const s = mySession(v);
      const expiry = BigInt(s?.expiry ?? Math.floor(Date.now() / 1000) + 86_400);
      const op = encode.setSessionLimits(session.address, expiry, parseUnits6(new_cap_usdt));
      const change = { action: op.action, data: op.data, nonce: BigInt(v.nonce ?? "0"), deadline: BigInt(Math.floor(Date.now() / 1000) + 600) };
      const sig = await session.account.signTypedData({ domain: leashDomain(CHAIN_ID, VAULT!), types: { MandateChange: leashTypes.MandateChange }, primaryType: "MandateChange", message: change });
      const { status, body } = await getJson<{ error?: string; message?: string; txHash?: string }>(`${FAC}/relay/applyChange`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(API_KEY ? { "x-api-key": API_KEY } : {}) },
        body: JSON.stringify({ vault: VAULT, change: { ...change, nonce: change.nonce.toString(), deadline: change.deadline.toString() }, pqPubKey: session.address, pqSig: sig, wa: null, attestorSig: "0x" }),
      });
      const out = status === 200 && body.txHash ? `!! The vault accepted the change: ${body.txHash}` : `Blocked by the vault contract: ${refusal(body.message ?? body.error ?? `HTTP ${status}`)}. Limits unchanged.`;
      log("change_my_limits", { new_cap_usdt }, out);
      return text(out);
    } catch (e) {
      return text(e instanceof Error ? e.message : String(e));
    }
  },
);

server.registerTool(
  "pay_address",
  {
    title: "Pay any address directly",
    description: "Attempts to send USDT from the vault to an arbitrary address by opening a payment channel to it.",
    inputSchema: { address: z.string(), amount_usdt: z.string() },
  },
  async ({ address, amount_usdt }) => {
    try {
      if (!isAddress(address)) return text("Not a valid address.");
      const v = await vaultView();
      const s = mySession(v);
      const now = BigInt(Math.floor(Date.now() / 1000));
      const expiry = s ? (BigInt(s.expiry) < now + 3600n ? BigInt(s.expiry) : now + 3600n) : now + 3600n;
      const request = { vault: VAULT!, merchant: getAddress(address), amount: parseUnits6(amount_usdt), expiry, sessionNonce: now * 1000n + BigInt(Math.floor(Math.random() * 1000)) };
      const sig = await signOpenChannel(session, CHAIN_ID, request);
      const { status, body } = await getJson<{ error?: string; message?: string; channelId?: string; txHash?: string }>(`${FAC}/channels/open`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(API_KEY ? { "x-api-key": API_KEY } : {}) },
        body: JSON.stringify({ chainId: CHAIN_ID, request: { ...request, amount: request.amount.toString(), expiry: request.expiry.toString(), sessionNonce: request.sessionNonce.toString() }, sig }),
      });
      const out = status === 200 ? `!! A channel to ${address} was opened: ${JSON.stringify(body)}` : `Blocked: ${refusal(body.message ?? body.error ?? `HTTP ${status}`)}. Nothing was sent.`;
      log("pay_address", { address, amount_usdt }, out);
      return text(out);
    } catch (e) {
      return text(e instanceof Error ? e.message : String(e));
    }
  },
);

// The same work inbox the ordinary wallet reads (side-by-side demo): the agent processes invoices from it.
const INBOX_FILE = process.env.LEASH_INBOX_FILE ?? join(homedir(), ".plain-wallet", "inbox.jsonl");
server.registerTool("read_inbox", { title: "Read email inbox", description: "Reads the latest emails in the shared work inbox (invoices and notifications).", inputSchema: {} }, async () => {
  const msgs = existsSync(INBOX_FILE) ? readFileSync(INBOX_FILE, "utf8").trim().split("\n").filter(Boolean).slice(-5).map((l) => JSON.parse(l)) : [];
  const out = msgs.length ? msgs.map((m: { at: string; from: string; subject: string; body: string }) => `[${m.at}] From ${m.from} — ${m.subject}\n${m.body}`).join("\n\n") : "Inbox empty.";
  log("read_inbox", {}, `${msgs.length} messages`);
  return text(out);
});

if (process.argv.includes("--print-address")) {
  console.log(session.address);
  process.exit(0);
}
console.error(`[leash] agent ${session.address} · vault ${VAULT ?? "(set LEASH_VAULT)"} · key ${KEY_FILE} · owner app ${WEB}`);
await server.connect(new StdioServerTransport());
