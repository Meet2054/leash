"use client";
import { useState } from "react";
import { api, explorerTx, short, usePoll } from "@/lib/client/api";
import type { OwnerSigner } from "@/lib/client/signer";
import { ApprovalRunner } from "./ApprovalRunner";

type Approval = {
  id: string;
  source: "agent" | "owner";
  vault: string;
  session: string | null;
  description: string;
  reason: string;
  status: string;
  statusReason: string | null;
  createdAt: number;
  txHash: string | null;
};

const color: Record<string, string> = { PENDING: "var(--color-warn)", APPROVING: "var(--color-brand)", APPROVED: "var(--color-ok)", DENIED: "var(--color-bad)", EXPIRED: "var(--color-bad)", FAILED: "var(--color-bad)" };

export function Approvals({ vault, chainId, signer }: { vault: string; chainId: number; signer: OwnerSigner | null }) {
  const { data, refresh } = usePoll<Approval[]>(`/api/approvals?vault=${vault}`, 2500);
  const [open, setOpen] = useState<string>();
  const deny = async (id: string) => {
    await api(`/api/approvals/${id}/deny`, {});
    refresh();
  };
  const list = data ?? [];
  return (
    <div className="space-y-3">
      <p className="text-sm muted">Agents can ask for more room. Only you can grant it: a fresh World ID check plus your post-quantum key. Denying changes nothing onchain.</p>
      {list.length === 0 && <div className="card muted text-sm">No requests yet.</div>}
      {list.map((a) => (
        <div key={a.id} className="card space-y-2">
          <div className="flex justify-between items-center gap-2">
            <div className="font-semibold text-sm">{a.description}</div>
            <span className="pill" style={{ color: color[a.status] }}>{a.status}</span>
          </div>
          <div className="text-xs muted">
            {a.source === "agent" ? <>requested by agent session <span className="mono">{short(a.session)}</span></> : "owner edit"} · {new Date(a.createdAt * 1000).toLocaleTimeString()}
          </div>
          {a.reason && (
            <div className="soft rounded-lg p-2 text-sm">
              <span className="muted">Agent says: </span>“{a.reason}”
            </div>
          )}
          {a.statusReason && <div className="text-xs muted">{a.statusReason}</div>}
          {a.txHash && <a className="text-sm underline" href={explorerTx(a.txHash)} target="_blank" rel="noreferrer">onchain tx</a>}
          {a.status === "PENDING" && open !== a.id && (
            <div className="flex gap-2">
              <button className="btn btn-primary" onClick={() => setOpen(a.id)}>Review & approve</button>
              <button className="btn btn-danger" onClick={() => deny(a.id)}>Deny</button>
            </div>
          )}
          {open === a.id && (
            <div className="space-y-2">
              <ApprovalRunner approvalId={a.id} vault={vault} chainId={chainId} signer={signer} onDone={refresh} />
              <button className="btn btn-danger" onClick={() => deny(a.id)}>Deny instead</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
