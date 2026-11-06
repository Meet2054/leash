import { BaseError, decodeErrorResult, type Abi, type Hex } from "viem";

/**
 * Name of the custom error behind a reverted eth_call. Tries viem's structured revert data first, then every
 * standalone 4-byte selector in the message (never the first hex blob: that is often an address).
 */
export function revertName(e: unknown, abi: Abi): string {
  const tryDecode = (data: string) => {
    try {
      return decodeErrorResult({ abi, data: data as Hex }).errorName;
    } catch {
      return undefined;
    }
  };
  if (e instanceof BaseError) {
    const withData = e.walk((x) => typeof (x as { data?: unknown }).data === "string") as { data?: string } | null;
    const name = withData?.data ? tryDecode(withData.data) : undefined;
    if (name) return name;
  }
  const msg = e instanceof Error ? e.message : String(e);
  for (const m of msg.matchAll(/0x[0-9a-fA-F]{8}(?![0-9a-fA-F])/g)) {
    const name = tryDecode(m[0]);
    if (name) return name;
  }
  return "reverted";
}
