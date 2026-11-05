import type { Address, Hex } from "viem";
import type { Store } from "./db.js";
import { jsonBigint } from "@leash/sdk";

export type AuditEvent = {
  kind: "ChannelOpened" | "Claimed" | "ChannelClosed" | "MandateChanged" | "VaultCreated" | "ApprovalDenied" | "ApprovalGranted" | "ClaimFailed" | "SessionRevoked" | string;
  chainId: number;
  vault?: Address;
  channelId?: Hex;
  amount?: string;
  tx?: Hex | string;
  data?: Record<string, unknown>;
};

/** External tamper-evident log (e.g. a Hedera HCS topic). Returns a reference such as "topic:seq". */
export type ExternalLog = { publish: (msg: string) => Promise<string | undefined>; describe: () => Record<string, unknown> };

export interface AuditSink {
  publish(e: AuditEvent): Promise<void>;
}

/** Writes every event to SQLite and, if configured, mirrors it to an external log (HCS). */
export class StoreAudit implements AuditSink {
  constructor(
    private readonly store: Store,
    private readonly external?: ExternalLog,
  ) {}

  async publish(e: AuditEvent): Promise<void> {
    const at = Math.floor(Date.now() / 1000);
    const id = this.store.insertEvent({
      at,
      kind: e.kind,
      chain_id: e.chainId,
      vault: e.vault ?? null,
      channel_id: e.channelId ?? null,
      amount: e.amount ?? null,
      tx: e.tx ?? null,
      data: e.data ? JSON.stringify(e.data, jsonBigint) : null,
    });
    if (!this.external) return;
    const msg = JSON.stringify(
      { event: e.kind, chainId: e.chainId, vault: e.vault, channelId: e.channelId, amount: e.amount, txHash: e.tx, ts: at, ...(e.data ?? {}) },
      jsonBigint,
    );
    // never block payments on the external log
    void this.external
      .publish(msg)
      .then((ref) => ref && this.store.setEventHcs(id, ref))
      .catch(() => undefined);
  }
}
