import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPublicClient, createWalletClient, http, keccak256, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ANVIL_KEYS, startAnvil, type Anvil } from "@leash/relayer";
import { anvilChain } from "@leash/facilitator/devnet";
import { compact16, falconKeygen, falconSign } from "../lib/client/falcon";

const OUT = new URL("../../../contracts/out/", import.meta.url).pathname;
const art = (f: string, n: string) => JSON.parse(readFileSync(`${OUT}${f}/${n}.json`, "utf8"));
const verifierAbi = [{ type: "function", name: "verify", stateMutability: "view", inputs: [{ type: "bytes" }, { type: "bytes32" }, { type: "bytes" }], outputs: [{ type: "bool" }] }] as const;

let anvil: Anvil;
let verifier: Address;
let pub: ReturnType<typeof createPublicClient>;

beforeAll(async () => {
  anvil = await startAnvil(["--code-size-limit", "50000"]);
  const chain = anvilChain(anvil.url);
  const wallet = createWalletClient({ chain, transport: http(anvil.url), account: privateKeyToAccount(ANVIL_KEYS[0]) });
  pub = createPublicClient({ chain, transport: http(anvil.url) });
  const deploy = async (a: { abi: unknown; bytecode: { object: Hex } }, args: unknown[] = []) =>
    (await pub.waitForTransactionReceipt({ hash: await wallet.deployContract({ abi: a.abi as never, bytecode: a.bytecode.object, args: args as never }) })).contractAddress!;
  const zknox = await deploy(art("ZKNOX_ethfalcon.sol", "ZKNOX_ethfalcon"));
  verifier = await deploy(art("EthFalconVerifier.sol", "EthFalconVerifier"), [zknox]);
}, 60_000);
afterAll(() => anvil?.stop());

describe("in-browser ETHFALCON (WASM) — gate M5", () => {
  it("compact16 packs coefficient i at bits 16·(i mod 16) of word ⌊i/16⌋", () => {
    const be = new Uint8Array(1024);
    be[0] = 0x00, be[1] = 0x05; // c0 = 5
    be[2] = 0x01, be[3] = 0x00; // c1 = 256
    const out = compact16(be);
    // word 0 big-endian: low 16 bits = 5, next 16 bits = 256
    expect(out[31]).toBe(5);
    expect(out[30]).toBe(0);
    expect(out[29]).toBe(0);
    expect(out[28]).toBe(1);
  });

  it("deterministic keygen from seed", async () => {
    const a = await falconKeygen(new Uint8Array(48).fill(7));
    const b = await falconKeygen(new Uint8Array(48).fill(7));
    expect(a.pubKey).toBe(b.pubKey);
    expect((a.pubKey.length - 2) / 2).toBe(1024);
  });

  it("a WASM signature over an EIP-712-style digest verifies in the real ZKNox verifier; tampering fails", async () => {
    const key = await falconKeygen();
    const digest = keccak256(toHex("leash: in-browser Falcon gate"));
    const t = performance.now();
    const sig = await falconSign(key, digest);
    const ms = performance.now() - t;
    expect((sig.length - 2) / 2).toBe(1064);
    expect(await pub.readContract({ address: verifier, abi: verifierAbi, functionName: "verify", args: [key.pubKey, digest, sig] })).toBe(true);
    const wrong = keccak256(toHex("something else"));
    expect(await pub.readContract({ address: verifier, abi: verifierAbi, functionName: "verify", args: [key.pubKey, wrong, sig] })).toBe(false);
    const other = await falconKeygen();
    expect(await pub.readContract({ address: verifier, abi: verifierAbi, functionName: "verify", args: [other.pubKey, digest, sig] })).toBe(false);
    console.log(`WASM Falcon sign: ${ms.toFixed(0)} ms`);
  }, 30_000);

  it("two signatures over the same digest use fresh randomness (different salts)", async () => {
    const key = await falconKeygen();
    const d = keccak256(toHex("x"));
    const [s1, s2] = [await falconSign(key, d), await falconSign(key, d)];
    expect(s1.slice(0, 82)).not.toBe(s2.slice(0, 82));
  });
});
