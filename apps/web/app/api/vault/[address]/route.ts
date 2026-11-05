import { erc20Abi, getAddress, isAddress, type Address } from "viem";
import { leashVaultAbi } from "@leash/sdk";
import { publicClient } from "@/lib/server/attestor";
import { deployment } from "@/lib/server/env";
import { err, handle, ok } from "@/lib/server/http";

export const dynamic = "force-dynamic";

type Scan = { block: bigint; sessions: Set<Address>; merchants: Set<Address> };
const g = globalThis as unknown as { __leashScans?: Map<string, Scan> };
const scans = (g.__leashScans ??= new Map());
const CHUNK = 9_000n;

/** Discover sessions/merchants from vault events (chunked getLogs, cached per vault). */
async function scan(vault: Address): Promise<Scan> {
  const s: Scan = scans.get(vault) ?? { block: BigInt(deployment.deployedAtBlock), sessions: new Set(), merchants: new Set() };
  const head = await publicClient.getBlockNumber();
  for (let from = s.block; from <= head; from += CHUNK) {
    const to = from + CHUNK - 1n > head ? head : from + CHUNK - 1n;
    const logs = await publicClient.getContractEvents({ address: vault, abi: leashVaultAbi, fromBlock: from, toBlock: to });
    for (const l of logs) {
      const a = l.args as { session?: Address; merchant?: Address };
      if (["SessionAdded", "SessionLimitsSet", "SessionRevoked"].includes(l.eventName) && a.session) s.sessions.add(getAddress(a.session));
      if (["MerchantSet", "MerchantRemoved"].includes(l.eventName) && a.merchant) s.merchants.add(getAddress(a.merchant));
    }
    s.block = to + 1n;
  }
  scans.set(vault, s);
  return s;
}

export async function GET(_req: Request, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!isAddress(address)) return err("bad address");
  return handle(async () => {
    const vault = getAddress(address);
    const code = await publicClient.getCode({ address: vault });
    const balance = await publicClient.readContract({ address: deployment.token, abi: erc20Abi, functionName: "balanceOf", args: [vault] });
    if (!code || code === "0x") return ok({ vault, deployed: false, balance });
    const read = <T,>(functionName: string, args: unknown[] = []) =>
      publicClient.readContract({ address: vault, abi: leashVaultAbi, functionName: functionName as never, args: args as never }) as Promise<T>;
    const [free, locked, nonce, subject, pqHash, verifier, s] = await Promise.all([
      read<bigint>("freeBalance"),
      read<bigint>("totalLocked"),
      read<bigint>("mandateNonce"),
      read<string>("worldSubjectHash"),
      read<string>("pqPubKeyHash"),
      read<string>("verifier"),
      scan(vault),
    ]);
    const sessions = await Promise.all(
      [...s.sessions].map(async (addr) => {
        const [expiry, revoked, cap, lockedS, spent] = await read<readonly [bigint, boolean, bigint, bigint, bigint]>("sessions", [addr]);
        return { address: addr, expiry, revoked, cap, locked: lockedS, spent };
      }),
    );
    const merchants = await Promise.all(
      [...s.merchants].map(async (addr) => {
        const [allowed, dayStart, dailyCap, spentToday, maxChannel] = await read<readonly [boolean, bigint, bigint, bigint, bigint]>("merchants", [addr]);
        return { address: addr, allowed, dayStart, dailyCap, spentToday, maxChannel };
      }),
    );
    return ok({ vault, deployed: true, balance, free, locked, nonce, worldSubjectHash: subject, pqPubKeyHash: pqHash, verifier, sessions, merchants });
  });
}
