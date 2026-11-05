import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Hex } from "viem";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const PY = `${ROOT}tools/owner-signer/.venv/bin/python`;
const SIGNER = `${ROOT}tools/owner-signer/falcon_signer.py`;
export const OWNER_KEY = process.env.OWNER_FALCON_KEY ?? `${ROOT}keys/owner.json`;

function run(args: string[]): Record<string, string> {
  return JSON.parse(execFileSync(PY, [SIGNER, ...args], { encoding: "utf8" }));
}

/** ETHFALCON-512 owner key (post-quantum). Generated and kept on this machine (keys/ is gitignored). */
export function ensureOwnerKey(path = OWNER_KEY): { pubKey: Hex; pubKeyHash: Hex } {
  if (!existsSync(path)) run(["keygen", "--out", path]);
  const r = run(["pubkey", "--key", path]);
  return { pubKey: r.pubKey as Hex, pubKeyHash: r.pubKeyHash as Hex };
}

export function falconSign(digest: Hex, path = OWNER_KEY): Hex {
  return run(["sign", "--key", path, "--digest", digest]).sig as Hex;
}
