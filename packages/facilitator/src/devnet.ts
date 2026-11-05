/**
 * Local devnet helpers (anvil only). Deploys MockUSDT + MockPQVerifier + LeashFactory from Foundry artifacts.
 * MockPQVerifier accepts ECDSA as the "PQ" signature — it exists for fast local tests and is NEVER used on
 * a public network (public deployments use contracts/script/Deploy.s.sol with the real ETHFALCON verifier).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseAbi,
  type Address,
  type Chain,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { leashFactoryAbi } from "@leash/sdk";

const OUT = fileURLToPath(new URL("../../../contracts/out/", import.meta.url));
const artifact = (file: string, name: string) => {
  const j = JSON.parse(readFileSync(`${OUT}${file}/${name}.json`, "utf8"));
  return { abi: j.abi, bytecode: j.bytecode.object as Hex };
};

export const anvilChain = (url: string): Chain =>
  defineChain({
    id: 31337,
    name: "Anvil (local)",
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [url] } },
  });

export type LocalDeployment = {
  chainId: number;
  token: Address;
  factory: Address;
  vaultImplementation: Address;
  verifier: Address;
  relayer: Address;
  attestor: Address;
  feeRecipient: Address;
  claimFee: string;
};

export async function deployLocal(opts: {
  rpcUrl: string;
  deployerKey: Hex;
  attestor: Address;
  feeRecipient: Address;
  claimFee?: bigint;
}): Promise<LocalDeployment> {
  const chain = anvilChain(opts.rpcUrl);
  const account = privateKeyToAccount(opts.deployerKey);
  const wallet = createWalletClient({ chain, transport: http(opts.rpcUrl), account });
  const pub = createPublicClient({ chain, transport: http(opts.rpcUrl) });
  const deploy = async (a: { abi: unknown; bytecode: Hex }, args: unknown[] = []) => {
    const hash = await wallet.deployContract({ abi: a.abi as never, bytecode: a.bytecode, args: args as never });
    const r = await pub.waitForTransactionReceipt({ hash });
    return r.contractAddress!;
  };
  const token = await deploy(artifact("Mocks.sol", "MockUSDT"));
  const verifier = await deploy(artifact("Mocks.sol", "MockPQVerifier"));
  const claimFee = opts.claimFee ?? 1000n;
  const factory = await deploy(artifact("LeashFactory.sol", "LeashFactory"), [
    token,
    opts.attestor,
    account.address,
    opts.feeRecipient,
    claimFee,
    verifier,
    false,
  ]);
  const vaultImplementation = await pub.readContract({ address: factory, abi: leashFactoryAbi, functionName: "implementation" });
  return { chainId: 31337, token, factory, vaultImplementation, verifier, relayer: account.address, attestor: opts.attestor, feeRecipient: opts.feeRecipient, claimFee: claimFee.toString() };
}

export const mockUsdtAbi = parseAbi([
  "function mint(address to, uint256 amount)",
  "function balanceOf(address) view returns (uint256)",
]);
