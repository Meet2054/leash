import type { Address, Hex } from "viem";
import type { PaymentRequirements, SchemeNetworkClient } from "@x402/core/types";
import { x402Client } from "@x402/core/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { channelIdOf } from "./eip712";
import { signOpenChannel, signVoucher, type LeashSession } from "./session";
import {
  KNOWN_ASSETS,
  LEASH_SCHEME,
  chainIdOfNetwork,
  type ChannelView,
  type LeashExtra,
  type LeashPayload,
  type OpenChannelRequest,
  type OpenChannelResponse,
} from "./scheme";

export type LeashClientEvent =
  | { type: "channel_opened"; merchant: Address; channelId: Hex; locked: bigint; txHash: Hex; explorerUrl: string }
  | { type: "channel_resumed"; merchant: Address; channelId: Hex; locked: bigint; cumulative: bigint }
  | { type: "voucher_signed"; merchant: Address; channelId: Hex; cumulative: bigint; price: bigint };

export type LeashClientOptions = {
  session: LeashSession;
  vault: Address;
  /** lock per channel; default max(extra.minChannel, 100 × price) */
  channelAmount?: (price: bigint, minChannel: bigint) => bigint;
  /** channel lifetime in seconds (default 1h); clamped to sessionExpiry */
  channelTtlSec?: number;
  /** unix seconds; channels never outlive the session */
  sessionExpiry?: bigint;
  /** fallback if a 402 does not carry extra.facilitatorUrl */
  facilitatorUrl?: string;
  /** partner lane key, sent as `x-api-key` to the facilitator (own rate-limit bucket) */
  apiKey?: string;
  fetch?: typeof fetch;
  onEvent?: (e: LeashClientEvent) => void;
};

type LocalChannel = { channelId: Hex; locked: bigint; cumulative: bigint; expiry: bigint };

const now = () => BigInt(Math.floor(Date.now() / 1000));
const EXPIRY_MARGIN = 120n;

/**
 * x402 client side of `leash-batch`: keeps one payment channel per merchant, opens it gaslessly through
 * the facilitator (the relayer pays gas) and signs a cumulative voucher for every paid request.
 */
export class LeashSchemeClient implements SchemeNetworkClient {
  readonly scheme = LEASH_SCHEME;
  private readonly channels = new Map<string, LocalChannel>();
  private readonly locks = new Map<string, Promise<unknown>>();
  private nonceCounter = 0n;

  constructor(private readonly opts: LeashClientOptions) {}

  findDefaultAsset = (asset: string, network: `${string}:${string}`) => {
    const known = KNOWN_ASSETS[network];
    return known && known.asset.toLowerCase() === asset.toLowerCase() ? known : undefined;
  };

  async createPaymentPayload(x402Version: number, req: PaymentRequirements) {
    const merchant = req.payTo as Address;
    const price = BigInt(req.amount);
    const chainId = chainIdOfNetwork(req.network);
    const extra = (req.extra ?? {}) as Partial<LeashExtra>;
    const facilitatorUrl = extra.facilitatorUrl ?? this.opts.facilitatorUrl;
    if (!facilitatorUrl) throw new Error("leash-batch: no facilitatorUrl in requirements or options");
    const key = `${chainId}:${merchant.toLowerCase()}`;

    return this.serialize(key, async () => {
      let ch = this.channels.get(key);
      if (!ch) ch = await this.resume(facilitatorUrl, merchant, key);
      if (!ch || ch.locked - ch.cumulative < price || ch.expiry - now() < EXPIRY_MARGIN) {
        ch = await this.open(facilitatorUrl, chainId, merchant, price, BigInt(extra.minChannel ?? "0"));
        this.channels.set(key, ch);
      }
      const cumulative = ch.cumulative + price;
      const voucherSig = await signVoucher(this.opts.session, chainId, this.opts.vault, {
        channelId: ch.channelId,
        cumulativeAmount: cumulative,
      });
      ch.cumulative = cumulative;
      this.opts.onEvent?.({ type: "voucher_signed", merchant, channelId: ch.channelId, cumulative, price });
      const payload: LeashPayload = {
        vault: this.opts.vault,
        session: this.opts.session.address,
        channelId: ch.channelId,
        cumulativeAmount: cumulative.toString(),
        voucherSig,
      };
      return { x402Version, payload };
    });
  }

  /** Forget local state for a merchant's channel (e.g. after a rejected voucher) so it is re-read. */
  /** Forget all local channel state; the next payment resumes from the facilitator's lastAccepted. */
  resyncAll() {
    this.channels.clear();
  }

  resync(chainId: number, merchant: Address) {
    this.channels.delete(`${chainId}:${merchant.toLowerCase()}`);
  }

  private async resume(facilitatorUrl: string, merchant: Address, key: string): Promise<LocalChannel | undefined> {
    const f = this.opts.fetch ?? fetch;
    const q = new URLSearchParams({ vault: this.opts.vault, session: this.opts.session.address, merchant });
    const res = await f(`${facilitatorUrl}/channels?${q}`, this.opts.apiKey ? { headers: { "x-api-key": this.opts.apiKey } } : undefined);
    if (!res.ok) return undefined;
    const list = (await res.json()) as ChannelView[];
    const open = list
      .filter((c) => c.status === "open" && BigInt(c.expiry) - now() > EXPIRY_MARGIN)
      .sort((a, b) => Number(BigInt(b.locked) - BigInt(b.lastAccepted) - (BigInt(a.locked) - BigInt(a.lastAccepted))))[0];
    if (!open) return undefined;
    const ch = {
      channelId: open.channelId,
      locked: BigInt(open.locked),
      cumulative: BigInt(open.lastAccepted),
      expiry: BigInt(open.expiry),
    };
    this.channels.set(key, ch);
    this.opts.onEvent?.({ type: "channel_resumed", merchant, channelId: ch.channelId, locked: ch.locked, cumulative: ch.cumulative });
    return ch;
  }

  private async open(
    facilitatorUrl: string,
    chainId: number,
    merchant: Address,
    price: bigint,
    minChannel: bigint,
  ): Promise<LocalChannel> {
    const amount = this.opts.channelAmount?.(price, minChannel) ?? (minChannel > price * 100n ? minChannel : price * 100n);
    let expiry = now() + BigInt(this.opts.channelTtlSec ?? 3600);
    if (this.opts.sessionExpiry && expiry > this.opts.sessionExpiry) expiry = this.opts.sessionExpiry;
    const sessionNonce = BigInt(Date.now()) * 1000n + this.nonceCounter++;
    const msg = { vault: this.opts.vault, merchant, amount, expiry, sessionNonce };
    const sig = await signOpenChannel(this.opts.session, chainId, msg);
    const body: OpenChannelRequest = {
      chainId,
      request: {
        vault: msg.vault,
        merchant,
        amount: amount.toString(),
        expiry: expiry.toString(),
        sessionNonce: sessionNonce.toString(),
      },
      sig,
    };
    const f = this.opts.fetch ?? fetch;
    const res = await f(`${facilitatorUrl}/channels/open`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(this.opts.apiKey ? { "x-api-key": this.opts.apiKey } : {}) },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`leash-batch: open channel failed (${res.status}): ${await res.text()}`);
    const out = (await res.json()) as OpenChannelResponse;
    const expected = channelIdOf(this.opts.vault, this.opts.session.address, merchant, sessionNonce);
    if (out.channelId.toLowerCase() !== expected.toLowerCase()) throw new Error("leash-batch: facilitator returned wrong channelId");
    this.opts.onEvent?.({
      type: "channel_opened",
      merchant,
      channelId: out.channelId,
      locked: BigInt(out.locked),
      txHash: out.txHash,
      explorerUrl: out.explorerUrl,
    });
    return { channelId: out.channelId, locked: BigInt(out.locked), cumulative: 0n, expiry: BigInt(out.expiry) };
  }

  private serialize<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.locks.set(
      key,
      next.catch(() => undefined),
    );
    return next;
  }
}

export type WrapOptions = LeashClientOptions & {
  networks?: `${string}:${string}`[];
  /** client-side guard on top of the onchain mandate: max atomic amount per single payment (default 1 USDT) */
  maxAmountPerPayment?: bigint;
};

/**
 * fetch wrapper: on 402 with a `leash-batch` requirement it opens/reuses a channel, signs a cumulative
 * voucher and retries with PAYMENT-SIGNATURE. The agent never holds gas and never picks a chain.
 */
export function wrapFetchWithLeash(baseFetch: typeof fetch, opts: WrapOptions) {
  const scheme = new LeashSchemeClient({ ...opts, fetch: opts.fetch ?? baseFetch });
  const networks = opts.networks ?? ["eip155:1874"];
  const client = new x402Client();
  for (const n of networks) client.register(n, scheme);
  client.setSpendControls({
    allowedAssets: networks
      .filter((n) => KNOWN_ASSETS[n])
      .map((n) => ({ network: n, asset: KNOWN_ASSETS[n].asset, maxAmountPerPayment: (opts.maxAmountPerPayment ?? 1_000_000n).toString() })),
  });
  const paid = wrapFetchWithPayment(baseFetch, client);
  // A rejected voucher means our local cumulative ran ahead of what the facilitator accepted:
  // drop local state so the next payment resumes from the facilitator (no silent overpayment).
  const wrapped = async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await paid(input, init);
    if (res.status === 402) scheme.resyncAll();
    return res;
  };
  return { fetch: wrapped as typeof fetch, scheme, client };
}
