import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  decodeErrorResult,
  formatEther,
  http,
  parseGwei,
  type Abi,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
  type WalletClient,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { RelayerError } from "./errors.js";
import { BudgetBook, Mutex } from "./limits.js";

export type AllowRule = (to: Address, selector: Hex) => boolean | Promise<boolean>;

export type RelayerConfig = {
  chain: Chain;
  rpcUrl: string;
  privateKey: Hex;
  /** only relay calls that pass this rule (known contracts + selectors) */
  allow: AllowRule;
  /** ABIs used to decode revert reasons from simulation */
  errorAbis?: Abi[];
  /** fee floor in gwei (Whitechain min base fee is 5) */
  gasFloorGwei?: string;
  /** auto-pause below this balance */
  minBalanceWei?: bigint;
  /** daily op budget per key */
  budgetLimit?: (key: string) => number | undefined;
  /** replace a stuck tx after this long (ms) */
  replaceAfterMs?: number;
  maxReplacements?: number;
  /** give up waiting for a receipt after this long (ms) */
  receiptTimeoutMs?: number;
  pollingIntervalMs?: number;
};

export type SendArgs = {
  to: Address;
  data: Hex;
  /** short label for logs and the gas tank (e.g. "claim", "openChannel") */
  label: string;
  /** budget keys consumed by this op (e.g. ["vault:0x..:open"]) */
  budgetKeys?: string[];
  /** gas limit override (skips estimation) */
  gas?: bigint;
};

export type SendResult = { hash: Hex; receipt: TransactionReceipt; costWei: bigint; replaced: number };

export type GasTankStatus = {
  address: Address;
  chainId: number;
  balanceWei: string;
  balance: string;
  paused: boolean;
  pauseReason?: string;
  minBalanceWei: string;
  spentTodayWei: string;
  opsToday: number;
  opsByLabel: Record<string, { count: number; costWei: string }>;
  avgCostWei: string;
  estOpsRemaining: number | null;
  budgets: Record<string, { used: number; limit?: number }>;
  pendingNonce: number | null;
};

/**
 * Gas-paying hot key. Every transaction is simulated with eth_call first and is never sent if it
 * would revert, so nobody can burn our gas with failing calls. Nonces come from a local manager
 * behind a mutex; stuck transactions are replaced with bumped fees.
 */
export class Relayer {
  readonly account: PrivateKeyAccount;
  readonly publicClient: PublicClient;
  readonly wallet: WalletClient;
  readonly budgets: BudgetBook;
  private readonly sendLock = new Mutex();
  private nextNonce: number | null = null;
  private manualPause: string | undefined;
  private lowBalance = false;
  private day = BudgetBook.today();
  private spentTodayWei = 0n;
  private opsToday = 0;
  private opsByLabel = new Map<string, { count: number; costWei: bigint }>();
  private totalCostWei = 0n;
  private totalOps = 0;

  constructor(private readonly cfg: RelayerConfig) {
    this.account = privateKeyToAccount(cfg.privateKey);
    const transport = http(cfg.rpcUrl, { retryCount: 2, batch: false });
    this.publicClient = createPublicClient({ chain: cfg.chain, transport, pollingInterval: cfg.pollingIntervalMs ?? 1000 });
    this.wallet = createWalletClient({ chain: cfg.chain, transport, account: this.account });
    this.budgets = new BudgetBook(cfg.budgetLimit ?? (() => undefined));
  }

  get address(): Address {
    return this.account.address;
  }

  pause(reason: string) {
    this.manualPause = reason;
  }
  resume() {
    this.manualPause = undefined;
  }

  /** eth_call as the relayer; throws RelayerError("simulation_reverted") with a decoded reason. */
  async simulate(to: Address, data: Hex): Promise<Hex | undefined> {
    try {
      const { data: ret } = await this.publicClient.call({ account: this.account, to, data });
      return ret;
    } catch (e) {
      throw new RelayerError("simulation_reverted", this.revertReason(e), { to, data: data.slice(0, 10) });
    }
  }

  async send(args: SendArgs): Promise<SendResult> {
    await this.ensureActive();
    const selector = args.data.slice(0, 10) as Hex;
    if (!(await this.cfg.allow(args.to, selector))) {
      throw new RelayerError("not_allowed", `refusing to relay ${selector} to ${args.to}`);
    }
    for (const k of args.budgetKeys ?? []) this.budgets.check(k);

    // 1) simulate — never send a tx that would revert
    await this.simulate(args.to, args.data);
    const gas =
      args.gas ??
      ((await this.publicClient.estimateGas({ account: this.account, to: args.to, data: args.data })) * 12n) / 10n;

    // 2) consume budgets only once we know the call is valid
    for (const k of args.budgetKeys ?? []) this.budgets.consume(k);

    // 3) allocate nonce + broadcast under the lock
    const fees = await this.fees();
    const { hash, nonce } = await this.sendLock.run(async () => {
      if (this.nextNonce === null) await this.syncNonce();
      const nonce = this.nextNonce!;
      try {
        const hash = await this.wallet.sendTransaction({
          account: this.account,
          chain: this.cfg.chain,
          to: args.to,
          data: args.data,
          gas,
          nonce,
          ...fees,
        });
        this.nextNonce = nonce + 1;
        return { hash, nonce };
      } catch (e) {
        await this.syncNonce(); // nonce may be stale (e.g. tx sent elsewhere); resync for the next op
        throw new RelayerError("send_failed", this.revertReason(e));
      }
    });

    // 4) wait, replacing with higher fees if stuck
    const { receipt, replaced } = await this.waitWithReplacement(hash, nonce, args, gas, fees);
    const costWei = receipt.gasUsed * receipt.effectiveGasPrice;
    this.record(args.label, costWei);
    if (receipt.status !== "success") {
      // should be impossible after simulation, but state can change between simulate and inclusion
      throw new RelayerError("simulation_reverted", `tx ${receipt.transactionHash} reverted on-chain`, { receipt });
    }
    return { hash: receipt.transactionHash, receipt, costWei, replaced };
  }

  async gasTank(): Promise<GasTankStatus> {
    const balance = await this.publicClient.getBalance({ address: this.address });
    this.lowBalance = balance < (this.cfg.minBalanceWei ?? 0n);
    this.rollDay();
    const avg = this.totalOps > 0 ? this.totalCostWei / BigInt(this.totalOps) : 0n;
    const opsByLabel: GasTankStatus["opsByLabel"] = {};
    for (const [k, v] of this.opsByLabel) opsByLabel[k] = { count: v.count, costWei: v.costWei.toString() };
    return {
      address: this.address,
      chainId: this.cfg.chain.id,
      balanceWei: balance.toString(),
      balance: formatEther(balance),
      paused: Boolean(this.manualPause) || this.lowBalance,
      pauseReason: this.manualPause ?? (this.lowBalance ? "gas tank below minimum balance" : undefined),
      minBalanceWei: (this.cfg.minBalanceWei ?? 0n).toString(),
      spentTodayWei: this.spentTodayWei.toString(),
      opsToday: this.opsToday,
      opsByLabel,
      avgCostWei: avg.toString(),
      estOpsRemaining: avg > 0n ? Number((balance - (this.cfg.minBalanceWei ?? 0n)) / avg) : null,
      budgets: this.budgets.usage(),
      pendingNonce: this.nextNonce,
    };
  }

  /** Current fees: maxFee = max(2 × baseFee, floor), small tip. */
  async fees(): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
    const block = await this.publicClient.getBlock({ blockTag: "latest" });
    const base = block.baseFeePerGas ?? 0n;
    const floor = parseGwei(this.cfg.gasFloorGwei ?? "5");
    let tip: bigint;
    try {
      tip = await this.publicClient.estimateMaxPriorityFeePerGas();
    } catch {
      tip = parseGwei("0.001");
    }
    const doubled = base * 2n;
    const maxFeePerGas = (doubled > floor ? doubled : floor) + tip;
    return { maxFeePerGas, maxPriorityFeePerGas: tip };
  }

  private async ensureActive() {
    if (this.manualPause) throw new RelayerError("paused", this.manualPause);
    if (this.cfg.minBalanceWei !== undefined) {
      const bal = await this.publicClient.getBalance({ address: this.address });
      this.lowBalance = bal < this.cfg.minBalanceWei;
      if (this.lowBalance) throw new RelayerError("paused", `gas tank low: ${formatEther(bal)} < ${formatEther(this.cfg.minBalanceWei)}`);
    }
  }

  /** Re-read the pending nonce from the chain (after a reorg or an external tx from this key). */
  async resyncNonce() {
    await this.sendLock.run(() => this.syncNonce());
  }

  private async syncNonce() {
    this.nextNonce = await this.publicClient.getTransactionCount({ address: this.address, blockTag: "pending" });
  }

  private async waitWithReplacement(
    hash: Hex,
    nonce: number,
    args: SendArgs,
    gas: bigint,
    fees: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint },
  ): Promise<{ receipt: TransactionReceipt; replaced: number }> {
    const replaceAfter = this.cfg.replaceAfterMs ?? 30_000;
    const maxReplacements = this.cfg.maxReplacements ?? 3;
    const deadline = Date.now() + (this.cfg.receiptTimeoutMs ?? 180_000);
    const hashes = [hash];
    let replaced = 0;
    let current = fees;
    while (Date.now() < deadline) {
      for (const h of hashes) {
        try {
          const r = await this.publicClient.waitForTransactionReceipt({ hash: h, timeout: Math.min(replaceAfter, deadline - Date.now()) });
          return { receipt: r, replaced };
        } catch {
          /* not mined yet: try other hashes / replace */
        }
      }
      if (replaced >= maxReplacements) continue;
      // replace: same nonce, fees +25%
      current = {
        maxFeePerGas: (current.maxFeePerGas * 125n) / 100n,
        maxPriorityFeePerGas: (current.maxPriorityFeePerGas * 125n) / 100n + 1n,
      };
      try {
        const h2 = await this.wallet.sendTransaction({
          account: this.account,
          chain: this.cfg.chain,
          to: args.to,
          data: args.data,
          gas,
          nonce,
          ...current,
        });
        hashes.unshift(h2);
        replaced++;
      } catch {
        /* "nonce too low" means one of our hashes got mined; the loop will find the receipt */
      }
    }
    throw new RelayerError("receipt_timeout", `no receipt for nonce ${nonce} (${hashes.join(", ")})`);
  }

  private record(label: string, costWei: bigint) {
    this.rollDay();
    this.spentTodayWei += costWei;
    this.opsToday++;
    this.totalCostWei += costWei;
    this.totalOps++;
    const e = this.opsByLabel.get(label) ?? { count: 0, costWei: 0n };
    e.count++;
    e.costWei += costWei;
    this.opsByLabel.set(label, e);
  }

  private rollDay() {
    const d = BudgetBook.today();
    if (d !== this.day) {
      this.day = d;
      this.spentTodayWei = 0n;
      this.opsToday = 0;
      this.opsByLabel.clear();
    }
  }

  revertReason(e: unknown): string {
    if (e instanceof BaseError) {
      const revert = e.walk((err) => err instanceof ContractFunctionRevertedError);
      if (revert instanceof ContractFunctionRevertedError && revert.data?.errorName) return revert.data.errorName;
      const raw = e.walk((err) => typeof (err as { data?: unknown }).data === "string") as { data?: Hex } | null;
      if (raw?.data && raw.data.length >= 10) {
        for (const abi of this.cfg.errorAbis ?? []) {
          try {
            return decodeErrorResult({ abi, data: raw.data }).errorName;
          } catch {
            /* try next */
          }
        }
        return `revert ${raw.data.slice(0, 10)}`;
      }
      return e.shortMessage;
    }
    return e instanceof Error ? e.message : String(e);
  }
}
