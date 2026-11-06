import { encodeAbiParameters, keccak256, toBytes, type Hex } from "viem";

/**
 * Agent flight recorder (feature F4). Every accepted payment becomes a leaf
 *   keccak256(abi.encode(bytes32 requestId, bytes32 resourceUrlHash, uint256 cumulative, uint64 timestamp))
 * and every claim publishes the Merkle root over that channel's new leaves to the HCS audit topic.
 * Anyone holding the facilitator log can prove it wasn't edited afterwards; nothing about the content
 * (URLs, bodies) is published — only hashes.
 */
export type VoucherLogRow = { id: number; channel_id: string; request_id: string; resource_hash: string; cumulative: string; at: number };

export function leafOf(r: Pick<VoucherLogRow, "request_id" | "resource_hash" | "cumulative" | "at">): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "uint64" }],
      [r.request_id as Hex, r.resource_hash as Hex, BigInt(r.cumulative), BigInt(r.at)],
    ),
  );
}

/** Ordered binary Merkle tree (keccak256 of the concatenated pair; an odd node is carried up unchanged). */
export function merkleRoot(leaves: Hex[]): Hex {
  if (leaves.length === 0) return `0x${"0".repeat(64)}`;
  let level = leaves;
  while (level.length > 1) {
    const next: Hex[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(i + 1 < level.length ? keccak256(`0x${level[i].slice(2)}${level[i + 1].slice(2)}`) : level[i]);
    }
    level = next;
  }
  return level[0];
}

export const resourceHash = (url: string | undefined): Hex => keccak256(toBytes(url ?? ""));

export type FlightRecord = { channelId: string; claimTx: string; merkleRoot: Hex; count: number; firstId: number; lastId: number };

/** Recompute each record's root from the log and compare with what was published (e.g. on HCS). */
export function verifyFlightRecords(log: VoucherLogRow[], published: FlightRecord[]) {
  return published.map((rec) => {
    const rows = log.filter((r) => r.channel_id.toLowerCase() === rec.channelId.toLowerCase() && r.id >= rec.firstId && r.id <= rec.lastId).sort((a, b) => a.id - b.id);
    const root = merkleRoot(rows.map(leafOf));
    return { ...rec, recomputed: root, rows: rows.length, ok: root === rec.merkleRoot && rows.length === rec.count };
  });
}
