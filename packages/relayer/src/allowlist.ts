import { getAddress, toFunctionSelector, type Address, type Hex, type PublicClient } from "viem";
import type { AllowRule } from "./relayer.js";

export const VAULT_SELECTORS: Hex[] = [
  "openChannel((address,address,uint256,uint64,uint256),bytes)",
  "claim(bytes32,uint256,bytes)",
  "closeExpired(bytes32)",
  "cooperativeClose(bytes32,uint256,bytes,bytes)",
  "applyChange((uint8,bytes,uint256,uint64),bytes,bytes,(address,bytes32,uint256,bytes32,uint64,uint64),bytes)",
  "revokeSessionBySig(address,bytes)",
].map((s) => toFunctionSelector(s));

export const FACTORY_SELECTORS: Hex[] = [
  "createVault((bytes32,bytes32,address,bytes),bytes,bytes,(address,bytes32,uint256,bytes32,uint64,uint64),bytes)",
].map((s) => toFunctionSelector(s));

/** EIP-1167 minimal proxy runtime code pointing at `implementation`. */
export function cloneRuntimeCode(implementation: Address): Hex {
  return `0x363d3d373d3d3d363d73${implementation.slice(2).toLowerCase()}5af43d82803e903d91602b57fd5bf3`;
}

/**
 * Only relay: createVault on our factory, and the vault selectors on contracts whose code is exactly an
 * EIP-1167 clone of our vault implementation (so a look-alike contract can't make us pay its gas).
 */
export function leashAllowRule(client: PublicClient, factory: Address, implementation: Address): AllowRule {
  const expected = cloneRuntimeCode(implementation);
  const known = new Map<string, boolean>();
  return async (to, selector) => {
    if (getAddress(to) === getAddress(factory)) return FACTORY_SELECTORS.includes(selector);
    if (!VAULT_SELECTORS.includes(selector)) return false;
    const key = to.toLowerCase();
    if (!known.has(key)) {
      const code = await client.getCode({ address: to });
      known.set(key, (code ?? "0x").toLowerCase() === expected);
    }
    return known.get(key)!;
  };
}
