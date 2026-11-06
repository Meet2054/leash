import {
  decodeEventLog,
  encodeFunctionData,
  getAddress,
  isAddress,
  isHex,
  keccak256,
  recoverTypedDataAddress,
  type Address,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import type { PaymentPayload, PaymentRequirements, SettleResponse, VerifyResponse } from "@x402/core/types";
import {
  EXPLORERS,
  INVALID,
  LEASH_SCHEME,
  leashDomain,
  leashTypes,
  leashVaultAbi,
  type ChannelView,
  type LeashPayload,
  type OpenChannelRequest,
  type OpenChannelResponse,
} from "@leash/sdk";
import { KeyedMutex, RateLimiter, Relayer, RelayerError } from "@leash/relayer";
import type { ChannelRow, Store } from "./db.js";
import type { AuditSink } from "./audit.js";
import type { CircuitBreaker } from "./breaker.js";
import { leafOf, merkleRoot, resourceHash } from "./flight.js";

export type EngineConfig = {
  chainId: number;
  network: `${string}:${string}`;
  factory: Address;
  implementation: Address;
  /** batcher: claim when unclaimed ≥ this (atomic) */
  claimThreshold: bigint;
  /** batcher: claim at least this often per channel with unclaimed value (s) */
  claimMaxWaitSec: number;
  /** batcher: claim when expiry is this close (s) */
  claimExpiryMarginSec: number;
  /** never relay a claim below this (atomic) unless the channel is about to expire */
  minEconomicClaim: bigint;
  /** reject vouchers on channels expiring within this window (s) */
  voucherExpiryMarginSec: number;
  /** per-vault channel opens per day */
  opensPerVaultPerDay: number;
  /** seconds a chain read stays cached */
  cacheTtlSec: number;
  vouchersPerSessionPerSec: number;
};

type OnchainChannel = { session: Address; expiry: bigint; closed: boolean; merchant: Address; locked: bigint; claimed: bigint };
type OnchainSession = { expiry: bigint; revoked: boolean };

const nowSec = () => Math.floor(Date.now() / 1000);
const invalid = (reason: string, message?: string): VerifyResponse => ({ isValid: false, invalidReason: reason, invalidMessage: message });

/**
 * leash-batch facilitator core. /verify checks a cumulative voucher against the channel's onchain state
 * and our last accepted voucher; /settle records it (serialized per channel) and defers value movement
 * to the batcher, which submits one claim carrying only the latest voucher.
 */
export class ChannelEngine {
  readonly locks = new KeyedMutex();
  private readonly cache = new Map<string, { at: number; v: unknown }>();
  private readonly voucherLimiter: RateLimiter;
  private readonly openLimiter = new RateLimiter(10, 0.2);
  /** API-key lane (e.g. the Break-the-Leash arena): its own, larger bucket instead of the shared per-IP one. */
  private readonly apiOpenLimiter = new RateLimiter(Number(process.env.API_OPEN_BURST ?? 60), Number(process.env.API_OPEN_PER_SEC ?? 2));
  private batching = false;

  constructor(
    readonly cfg: EngineConfig,
    readonly store: Store,
    readonly relayer: Relayer,
    readonly client: PublicClient,
    readonly audit: AuditSink,
    private readonly isLeashVault: (vault: Address) => Promise<boolean>,
    readonly breaker?: CircuitBreaker,
  ) {
    this.voucherLimiter = new RateLimiter(Math.max(5, cfg.vouchersPerSessionPerSec * 5), cfg.vouchersPerSessionPerSec);
  }

  // ------------------------------------------------------------------ chain reads (cached)

  private async cached<T>(key: string, fn: () => Promise<T>, fresh = false): Promise<T> {
    const hit = this.cache.get(key);
    if (!fresh && hit && Date.now() - hit.at < this.cfg.cacheTtlSec * 1000) return hit.v as T;
    const v = await fn();
    this.cache.set(key, { at: Date.now(), v });
    return v;
  }

  async readChannel(vault: Address, id: Hex, fresh = false): Promise<OnchainChannel> {
    return this.cached(`ch:${id}`, async () => {
      const [session, expiry, closed, merchant, locked, claimed] = await this.client.readContract({
        address: vault,
        abi: leashVaultAbi,
        functionName: "channels",
        args: [id],
      });
      return { session, expiry: BigInt(expiry), closed, merchant, locked: BigInt(locked), claimed: BigInt(claimed) };
    }, fresh);
  }

  async readSession(vault: Address, session: Address): Promise<OnchainSession> {
    return this.cached(`s:${vault}:${session}`, async () => {
      const [expiry, revoked] = await this.client.readContract({
        address: vault,
        abi: leashVaultAbi,
        functionName: "sessions",
        args: [session],
      });
      return { expiry: BigInt(expiry), revoked };
    });
  }

  // ------------------------------------------------------------------ x402 verify / settle

  private parse(payload: PaymentPayload): LeashPayload | undefined {
    const p = payload.payload as Partial<LeashPayload>;
    if (!p || !isAddress(p.vault ?? "") || !isAddress(p.session ?? "")) return undefined;
    if (!isHex(p.channelId) || p.channelId.length !== 66 || !isHex(p.voucherSig)) return undefined;
    if (typeof p.cumulativeAmount !== "string" || !/^\d+$/.test(p.cumulativeAmount)) return undefined;
    return p as LeashPayload;
  }

  /** `countRate=false` for the re-check inside settle, so one paid request costs one rate-limit token. */
  async verify(payload: PaymentPayload, req: PaymentRequirements, countRate = true): Promise<VerifyResponse> {
    if (req.scheme !== LEASH_SCHEME || req.network !== this.cfg.network) return invalid(INVALID.wrongScheme);
    const p = this.parse(payload);
    if (!p) return invalid(INVALID.badPayload);
    const cumulative = BigInt(p.cumulativeAmount);
    const price = BigInt(req.amount);

    // F2 circuit breaker: every paid-request attempt counts (accepted or not); an open breaker stops the vault
    if (this.breaker) {
      if (countRate) this.breaker.recordRequest(p.vault, p.session);
      if (this.breaker.isOpen(p.vault)) return invalid(INVALID.circuitOpen, this.breaker.status(p.vault).detail);
    }
    if (countRate && !this.voucherLimiter.take(`session:${p.session.toLowerCase()}`)) return invalid(INVALID.rateLimited);

    let signer: Address;
    try {
      signer = await recoverTypedDataAddress({
        domain: leashDomain(this.cfg.chainId, p.vault),
        types: leashTypes,
        primaryType: "Voucher",
        message: { channelId: p.channelId, cumulativeAmount: cumulative },
        signature: p.voucherSig,
      });
    } catch {
      return invalid(INVALID.badSignature);
    }
    if (getAddress(signer) !== getAddress(p.session)) return invalid(INVALID.badSignature);

    let ch: OnchainChannel;
    try {
      ch = await this.readChannel(p.vault, p.channelId);
    } catch {
      return invalid(INVALID.unknownChannel);
    }
    if (ch.session === "0x0000000000000000000000000000000000000000") return invalid(INVALID.unknownChannel);
    if (getAddress(ch.session) !== getAddress(p.session)) return invalid(INVALID.sessionMismatch);
    if (getAddress(ch.merchant) !== getAddress(req.payTo)) return invalid(INVALID.merchantMismatch);
    if (ch.closed) return invalid(INVALID.channelClosed);
    if (Number(ch.expiry) - nowSec() < this.cfg.voucherExpiryMarginSec) return invalid(INVALID.channelExpiring);

    const s = await this.readSession(p.vault, p.session);
    if (s.revoked || Number(s.expiry) <= nowSec()) return invalid(INVALID.sessionInactive);

    const row = this.store.channel(p.channelId);
    const lastAccepted = maxBig(BigInt(row?.last_accepted ?? "0"), ch.claimed);
    if (cumulative - lastAccepted < price) {
      return invalid(INVALID.insufficientIncrement, `cumulative ${cumulative} - lastAccepted ${lastAccepted} < price ${price}`);
    }
    if (cumulative > ch.locked) return invalid(INVALID.exceedsLocked);
    return { isValid: true, payer: p.session };
  }

  async settle(payload: PaymentPayload, req: PaymentRequirements): Promise<SettleResponse> {
    const p = this.parse(payload);
    const fail = (errorReason: string, errorMessage?: string): SettleResponse => ({
      success: false,
      errorReason,
      errorMessage,
      transaction: "",
      network: req.network as `${string}:${string}`,
    });
    if (!p) return fail(INVALID.badPayload);
    return this.locks.run(p.channelId.toLowerCase(), async () => {
      // re-verify under the channel lock: concurrent vouchers are ordered here
      const v = await this.verify(payload, req, false);
      if (!v.isValid) return fail(v.invalidReason ?? "invalid", v.invalidMessage);
      this.ensureRow(p);
      this.store.tx(() => {
        this.store.acceptVoucher(p.channelId, p.cumulativeAmount, p.voucherSig);
        // F4 flight recorder: one leaf per accepted payment (hashes only)
        const url = (payload as { resource?: { url?: string } }).resource?.url;
        this.store.logVoucher(p.channelId, keccak256(p.voucherSig), resourceHash(url), p.cumulativeAmount, nowSec());
      });
      return {
        success: true,
        transaction: "",
        network: req.network as `${string}:${string}`,
        payer: p.session,
        amount: req.amount,
        extra: { channelId: p.channelId, cumulativeAmount: p.cumulativeAmount, pendingClaim: true },
      };
    });
  }

  /** Channels opened elsewhere (not via our /channels/open) still get a row so the batcher can claim them. */
  private ensureRow(p: LeashPayload) {
    if (this.store.channel(p.channelId)) return;
    const ch = this.cache.get(`ch:${p.channelId}`)?.v as OnchainChannel | undefined;
    if (!ch) return;
    this.store.insertChannel({
      id: p.channelId.toLowerCase(),
      chain_id: this.cfg.chainId,
      vault: p.vault,
      session: p.session,
      merchant: ch.merchant,
      locked: ch.locked.toString(),
      expiry: Number(ch.expiry),
      open_tx: null,
      opened_at: nowSec(),
    });
  }

  // ------------------------------------------------------------------ channel opening (gasless for the agent)

  /** `caller` is "key:<name>" for an authenticated API key, otherwise "ip:<address>" (or a bare IP). */
  async openChannel(body: OpenChannelRequest, caller = "?"): Promise<OpenChannelResponse> {
    if (body.chainId !== this.cfg.chainId) throw new RelayerError("not_allowed", `wrong chain ${body.chainId}`);
    const r = body.request;
    if (!isAddress(r.vault) || !isHex(body.sig) || !isAddress(r.merchant)) throw new RelayerError("not_allowed", "bad request");
    const lane = caller.startsWith("key:") ? caller : `ip:${caller.replace(/^ip:/, "")}`;
    const laneLimiter = lane.startsWith("key:") ? this.apiOpenLimiter : this.openLimiter;
    if (!laneLimiter.take(lane) || !this.openLimiter.take(`vault:${r.vault.toLowerCase()}`)) {
      throw new RelayerError("rate_limited", "too many channel opens");
    }
    if (!(await this.isLeashVault(r.vault))) throw new RelayerError("not_allowed", "vault was not created by the Leash factory");
    if (this.breaker) {
      let session: Address = "0x0000000000000000000000000000000000000000";
      try {
        session = await recoverTypedDataAddress({
          domain: leashDomain(this.cfg.chainId, r.vault),
          types: leashTypes,
          primaryType: "OpenChannel",
          message: { vault: r.vault, merchant: r.merchant, amount: BigInt(r.amount), expiry: BigInt(r.expiry), sessionNonce: BigInt(r.sessionNonce) },
          signature: body.sig,
        });
      } catch {
        /* the vault will reject a bad signature in simulation */
      }
      this.breaker.recordChannelOpen(r.vault, session);
      if (this.breaker.isOpen(r.vault)) throw new RelayerError("circuit_open", this.breaker.status(r.vault).detail ?? "circuit breaker open");
    }
    const req = {
      vault: r.vault,
      merchant: r.merchant,
      amount: BigInt(r.amount),
      expiry: BigInt(r.expiry),
      sessionNonce: BigInt(r.sessionNonce),
    };
    const data = encodeFunctionData({ abi: leashVaultAbi, functionName: "openChannel", args: [req, body.sig] });
    const sent = await this.relayer.send({
      to: r.vault,
      data,
      label: "openChannel",
      budgetKeys: [`vault:${r.vault.toLowerCase()}:open`],
    });
    const ev = findEvent(sent.receipt, "ChannelOpened");
    if (!ev) throw new RelayerError("send_failed", "no ChannelOpened event");
    const { channelId, session, merchant, amount, expiry } = ev.args as {
      channelId: Hex;
      session: Address;
      merchant: Address;
      amount: bigint;
      expiry: bigint;
    };
    this.store.insertChannel({
      id: channelId.toLowerCase(),
      chain_id: this.cfg.chainId,
      vault: r.vault,
      session,
      merchant,
      locked: amount.toString(),
      expiry: Number(expiry),
      open_tx: sent.hash,
      opened_at: nowSec(),
    });
    await this.audit.publish({
      kind: "ChannelOpened",
      chainId: this.cfg.chainId,
      vault: r.vault,
      channelId,
      amount: amount.toString(),
      tx: sent.hash,
      data: { session, merchant, expiry: expiry.toString() },
    });
    return {
      channelId,
      txHash: sent.hash,
      locked: amount.toString(),
      expiry: expiry.toString(),
      explorerUrl: EXPLORERS[this.cfg.chainId]?.tx(sent.hash) ?? sent.hash,
    };
  }

  channelView(row: ChannelRow): ChannelView {
    return {
      channelId: row.id as Hex,
      vault: getAddress(row.vault),
      session: getAddress(row.session),
      merchant: getAddress(row.merchant),
      locked: row.locked,
      lastAccepted: row.last_accepted,
      claimedOnchain: row.claimed_onchain,
      expiry: String(row.expiry),
      status: row.status,
    };
  }

  // ------------------------------------------------------------------ batcher

  /**
   * F3 reorg safety: if a recent claim tx is no longer reflected onchain (L2 reorg / rollback), roll our
   * bookkeeping back to the chain's truth and resync the relayer nonce. The next batch then claims the
   * latest cumulative voucher again. Cumulative vouchers are idempotent and the vault enforces
   * `cumulative > claimed`, so the merchant is paid exactly once, for the right total.
   */
  async reconcileClaims(sinceSec = 3600): Promise<number> {
    let rolledBack = 0;
    for (const cl of this.store.recentClaims(sinceSec)) {
      const row = this.store.channel(cl.channel_id);
      if (!row) continue;
      const onchain = await this.readChannel(getAddress(row.vault), row.id as Hex, true);
      if (onchain.claimed >= BigInt(cl.cumulative)) continue; // still there
      const receipt = await this.client.getTransactionReceipt({ hash: cl.tx as Hex }).catch(() => undefined);
      if (receipt && receipt.status === "success") continue; // mined; the read was stale
      this.store.rollbackClaim(cl.tx, row.id, onchain.claimed.toString());
      rolledBack++;
      await this.audit.publish({
        kind: "ClaimReorged",
        chainId: this.cfg.chainId,
        vault: getAddress(row.vault),
        channelId: row.id as Hex,
        amount: cl.delta,
        tx: cl.tx,
        data: { onchainClaimed: onchain.claimed.toString(), cumulative: cl.cumulative },
      });
    }
    if (rolledBack) await this.relayer.resyncNonce();
    return rolledBack;
  }

  /** One batching pass. Returns the claim tx hashes it sent. */
  async runBatch(force = false): Promise<Hex[]> {
    if (this.batching) return [];
    this.batching = true;
    const sent: Hex[] = [];
    try {
      await this.reconcileClaims();
      const now = nowSec();
      for (const row of this.store.openChannelsWithUnclaimed()) {
        const unclaimed = BigInt(row.last_accepted) - BigInt(row.claimed_onchain);
        const sinceLast = now - (row.last_claim_at ?? row.opened_at);
        const nearExpiry = row.expiry - now <= this.cfg.claimExpiryMarginSec;
        const due = force || unclaimed >= this.cfg.claimThreshold || sinceLast >= this.cfg.claimMaxWaitSec || nearExpiry;
        if (!due) continue;
        if (unclaimed < this.cfg.minEconomicClaim && !nearExpiry && !force) {
          this.store.bump("claims_deferred_uneconomic");
          continue;
        }
        try {
          const h = await this.claim(row);
          if (h) sent.push(h);
        } catch (e) {
          await this.audit.publish({
            kind: "ClaimFailed",
            chainId: this.cfg.chainId,
            vault: row.vault as Address,
            channelId: row.id as Hex,
            amount: unclaimed.toString(),
            data: { error: e instanceof Error ? e.message : String(e) },
          });
        }
      }
      await this.closeExpiredChannels();
    } finally {
      this.batching = false;
    }
    return sent;
  }

  /** Submit one claim carrying only the latest cumulative voucher. */
  async claim(row: ChannelRow): Promise<Hex | undefined> {
    // read a consistent (cumulative, sig) pair under the channel lock, send outside it
    const snap = await this.locks.run(row.id, async () => this.store.channel(row.id)!);
    if (!snap.last_sig || BigInt(snap.last_accepted) <= BigInt(snap.claimed_onchain)) return undefined;
    const data = encodeFunctionData({
      abi: leashVaultAbi,
      functionName: "claim",
      args: [snap.id as Hex, BigInt(snap.last_accepted), snap.last_sig as Hex],
    });
    const sent = await this.relayer.send({
      to: getAddress(snap.vault),
      data,
      label: "claim",
      budgetKeys: [`merchant:${snap.merchant}:claim`],
    });
    const ev = findEvent(sent.receipt, "Claimed");
    const args = (ev?.args ?? {}) as { delta?: bigint; cumulativeAmount?: bigint; fee?: bigint };
    const closed = BigInt(snap.last_accepted) === BigInt(snap.locked);
    const tx = await this.client.getTransaction({ hash: sent.hash });
    const now = nowSec();
    this.store.tx(() => {
      this.store.markClaimed(snap.id, snap.last_accepted, snap.vouchers, now, closed);
      this.store.insertClaim({
        tx: sent.hash,
        channel_id: snap.id,
        chain_id: this.cfg.chainId,
        merchant: snap.merchant,
        delta: (args.delta ?? 0n).toString(),
        cumulative: snap.last_accepted,
        fee: (args.fee ?? 0n).toString(),
        vouchers_covered: snap.vouchers - snap.vouchers_at_last_claim,
        calldata_bytes: (tx.input.length - 2) / 2,
        gas_used: sent.receipt.gasUsed.toString(),
        cost_wei: sent.costWei.toString(),
        at: now,
      });
    });
    this.cache.delete(`ch:${snap.id}`);
    // F4: Merkle root over this channel's payments since the last claim → HCS
    const rows = this.store.unrecordedVouchers(snap.id);
    if (rows.length) {
      const root = merkleRoot(rows.map(leafOf));
      this.store.insertFlightRecord({ claimTx: sent.hash, channelId: snap.id, merkleRoot: root, count: rows.length, firstId: rows[0].id, lastId: rows[rows.length - 1].id });
      await this.audit.publish({
        kind: "FlightRecord",
        chainId: this.cfg.chainId,
        vault: getAddress(snap.vault),
        channelId: snap.id as Hex,
        tx: sent.hash,
        data: { merkleRoot: root, count: rows.length, firstId: rows[0].id, lastId: rows[rows.length - 1].id },
      });
    }
    await this.audit.publish({
      kind: "Claimed",
      chainId: this.cfg.chainId,
      vault: getAddress(snap.vault),
      channelId: snap.id as Hex,
      amount: (args.delta ?? 0n).toString(),
      tx: sent.hash,
      data: {
        merchant: snap.merchant,
        cumulative: snap.last_accepted,
        fee: (args.fee ?? 0n).toString(),
        vouchersCovered: snap.vouchers - snap.vouchers_at_last_claim,
      },
    });
    return sent.hash;
  }

  /** Release locks of channels past expiry + GRACE back to their vaults (anyone may call; we pay). */
  private async closeExpiredChannels() {
    const grace = 15 * 60;
    const now = nowSec();
    for (const row of this.store.openChannels()) {
      if (row.expiry + grace >= now) continue;
      if (BigInt(row.last_accepted) > BigInt(row.claimed_onchain)) continue; // claim first
      try {
        const onchain = await this.readChannel(getAddress(row.vault), row.id as Hex, true);
        if (onchain.closed) {
          this.store.setStatus(row.id, "closed");
          continue;
        }
        const sent = await this.relayer.send({
          to: getAddress(row.vault),
          data: encodeFunctionData({ abi: leashVaultAbi, functionName: "closeExpired", args: [row.id as Hex] }),
          label: "closeExpired",
        });
        this.store.setStatus(row.id, "closed");
        await this.audit.publish({
          kind: "ChannelClosed",
          chainId: this.cfg.chainId,
          vault: getAddress(row.vault),
          channelId: row.id as Hex,
          amount: (BigInt(row.locked) - BigInt(row.claimed_onchain)).toString(),
          tx: sent.hash,
        });
      } catch {
        /* retry next pass */
      }
    }
  }
}

export function findEvent(receipt: TransactionReceipt, name: string) {
  for (const log of receipt.logs) {
    try {
      const ev = decodeEventLog({ abi: leashVaultAbi, data: log.data, topics: log.topics });
      if (ev.eventName === name) return ev;
    } catch {
      /* not ours */
    }
  }
  return undefined;
}

const maxBig = (a: bigint, b: bigint) => (a > b ? a : b);
