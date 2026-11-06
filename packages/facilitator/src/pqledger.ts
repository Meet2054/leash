import { decodeFunctionData, getAddress, parseAbi, type Address, type Hex, type PublicClient } from "viem";
import { EXPLORERS, initConfigDigest, leashFactoryAbi, leashVaultAbi, mandateChangeDigest, ACTION_NAMES, type Action } from "@leash/sdk";

/**
 * PQ Ledger (feature F1): every transaction in which an ETHFALCON signature was verified onchain —
 * vault creation (InitConfig) and every mandate change (MandateChange). For each tx we decode the Falcon
 * public key and signature from calldata, recompute the EIP-712 digest, and measure the verify cost by
 * simulating EthFalconVerifier.verify(pubKey, digest, sig) (eth_estimateGas − 21,000 intrinsic).
 */
export type PqLedgerEntry = {
  kind: "createVault" | "applyChange";
  action: string;
  vault: Address;
  tx: Hex;
  block: string;
  timestamp: number;
  gasUsed: string;
  pqVerifyGas: string;
  pqShare: number; // pqVerifyGas / gasUsed
  pubKeyBytes: number;
  sigBytes: number;
  calldataBytes: number;
  loosening?: boolean;
  explorerUrl: string;
};

const verifierAbi = parseAbi(["function verify(bytes pubKey, bytes32 digest, bytes sig) view returns (bool)"]);
const CHUNK = 9_000n;

export class PqLedger {
  private cache = new Map<string, PqLedgerEntry>();
  private scannedTo: bigint;
  private vaults = new Set<Address>();
  private createTxs = new Map<Hex, Address>(); // tx → vault

  constructor(
    private readonly client: PublicClient,
    private readonly chainId: number,
    private readonly factory: Address,
    fromBlock: bigint,
  ) {
    this.scannedTo = fromBlock - 1n;
  }

  /** Incrementally scan factory + vault logs, then build entries for new txs. */
  async entries(): Promise<PqLedgerEntry[]> {
    const head = await this.client.getBlockNumber();
    const txs: { tx: Hex; vault: Address; kind: "createVault" | "applyChange"; loosening?: boolean; block: bigint }[] = [];
    for (let from = this.scannedTo + 1n; from <= head; from += CHUNK) {
      const to = from + CHUNK - 1n > head ? head : from + CHUNK - 1n;
      const created = await this.client.getContractEvents({ address: this.factory, abi: leashFactoryAbi, eventName: "VaultCreated", fromBlock: from, toBlock: to });
      for (const l of created) {
        const vault = getAddress((l.args as { vault: Address }).vault);
        this.vaults.add(vault);
        this.createTxs.set(l.transactionHash, vault);
        txs.push({ tx: l.transactionHash, vault, kind: "createVault", block: l.blockNumber });
      }
      for (const vault of this.vaults) {
        const changes = await this.client.getContractEvents({ address: vault, abi: leashVaultAbi, eventName: "MandateChanged", fromBlock: from, toBlock: to });
        for (const l of changes) txs.push({ tx: l.transactionHash, vault, kind: "applyChange", loosening: (l.args as { loosening?: boolean }).loosening, block: l.blockNumber });
      }
      this.scannedTo = to;
    }
    for (const t of txs) {
      if (this.cache.has(t.tx)) continue;
      try {
        this.cache.set(t.tx, await this.build(t));
      } catch {
        /* skip txs we can't decode (shouldn't happen) */
      }
    }
    return [...this.cache.values()].sort((a, b) => Number(BigInt(a.block) - BigInt(b.block)));
  }

  private async build(t: { tx: Hex; vault: Address; kind: "createVault" | "applyChange"; loosening?: boolean; block: bigint }): Promise<PqLedgerEntry> {
    const [tx, receipt, block] = await Promise.all([
      this.client.getTransaction({ hash: t.tx }),
      this.client.getTransactionReceipt({ hash: t.tx }),
      this.client.getBlock({ blockNumber: t.block }),
    ]);
    let pubKey: Hex, sig: Hex, digest: Hex, verifier: Address, action: string;
    if (t.kind === "createVault") {
      const { args } = decodeFunctionData({ abi: leashFactoryAbi, data: tx.input });
      const [cfg, pk, s] = args as unknown as [{ pqPubKeyHash: Hex; worldSubjectHash: Hex; verifier: Address; initialMandate: Hex }, Hex, Hex];
      pubKey = pk;
      sig = s;
      digest = initConfigDigest(this.chainId, this.factory, cfg);
      verifier = cfg.verifier;
      action = "CREATE_VAULT";
    } else {
      const { args } = decodeFunctionData({ abi: leashVaultAbi, data: tx.input });
      const [change, pk, s] = args as unknown as [{ action: number; data: Hex; nonce: bigint; deadline: bigint }, Hex, Hex];
      pubKey = pk;
      sig = s;
      digest = mandateChangeDigest(this.chainId, t.vault, change);
      verifier = await this.client.readContract({ address: t.vault, abi: leashVaultAbi, functionName: "verifier" });
      action = ACTION_NAMES[change.action as Action] ?? `ACTION_${change.action}`;
    }
    const est = await this.client.estimateGas({
      to: verifier,
      data: (await import("viem")).encodeFunctionData({ abi: verifierAbi, functionName: "verify", args: [pubKey, digest, sig] }),
    });
    const pqVerifyGas = est - 21_000n;
    return {
      kind: t.kind,
      action,
      vault: t.vault,
      tx: t.tx,
      block: t.block.toString(),
      timestamp: Number(block.timestamp),
      gasUsed: receipt.gasUsed.toString(),
      pqVerifyGas: pqVerifyGas.toString(),
      pqShare: Number(pqVerifyGas) / Number(receipt.gasUsed),
      pubKeyBytes: (pubKey.length - 2) / 2,
      sigBytes: (sig.length - 2) / 2,
      calldataBytes: (tx.input.length - 2) / 2,
      loosening: t.loosening,
      explorerUrl: EXPLORERS[this.chainId]?.tx(t.tx) ?? t.tx,
    };
  }
}

/** Summary: what PQ costs us vs. what it would cost if every payment carried a Falcon signature. */
export function pqSummary(entries: PqLedgerEntry[], vouchersServed: number) {
  const n = entries.length;
  const avgVerify = n ? entries.reduce((a, e) => a + Number(e.pqVerifyGas), 0) / n : 0;
  return {
    pqVerifiedTxs: n,
    avgPqVerifyGas: Math.round(avgVerify),
    signatureBytesPerPqTx: 1064,
    publicKeyBytesPerPqTx: 1024,
    paymentsSettled: vouchersServed,
    ifEveryPaymentWerePqVerified: {
      extraGas: Math.round(avgVerify * vouchersServed),
      extraSignatureBytes: 1064 * vouchersServed,
    },
    leashActual: { pqTxs: n, pqGas: Math.round(avgVerify * n), pqSignatureBytes: 1064 * n },
  };
}
