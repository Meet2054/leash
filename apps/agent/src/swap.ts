/**
 * Fund a vault with real Whitechain testnet USDT: swap WBT → USDT on the testnet Uniswap V3 pool, with the
 * vault (or its counterfactual address) as the recipient. Sent from the relayer key, so restart the
 * facilitator afterwards (its nonce manager resyncs on start).
 *   pnpm --filter @leash/agent exec tsx --env-file=../../.env src/swap.ts <wbt> <recipient>
 * Simulates first and refuses more than 2% slippage against the simulated output.
 */
import { createWalletClient, formatUnits, getAddress, http, parseEther, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { whitechainSepolia } from "viem/chains";
import { deployment, publicClient } from "./lib/config.js";

const WWBT = "0x4200000000000000000000000000000000000006" as const;
const ROUTER = "0xe208cC685cD95D56E8ec6DEC9816476567fc6962" as const;
const POOL = "0x5645101Ca8d2F7BaBC27b10359555767a1BdF999" as const;

const routerAbi = [
  {
    type: "function",
    name: "exactInputSingle",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "recipient", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
] as const;
const erc20 = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }] as const;

const [wbt, to] = process.argv.slice(2);
if (!wbt || !to) throw new Error("usage: swap.ts <wbt> <recipient>");
const recipient = getAddress(to);
const amountIn = parseEther(wbt);
const account = privateKeyToAccount(process.env.RELAYER_PK_WHITECHAIN as Hex);
const wallet = createWalletClient({ account, chain: whitechainSepolia, transport: http(process.env.WHITECHAIN_RPC ?? "https://rpc.testnet.whitechain.io") });

const fee = await publicClient.readContract({ address: POOL, abi: [{ type: "function", name: "fee", stateMutability: "view", inputs: [], outputs: [{ type: "uint24" }] }], functionName: "fee" });
const params = { tokenIn: WWBT, tokenOut: deployment.token, fee, recipient, amountIn, amountOutMinimum: 0n, sqrtPriceLimitX96: 0n } as const;
const sim = await publicClient.simulateContract({ account, address: ROUTER, abi: routerAbi, functionName: "exactInputSingle", args: [params], value: amountIn });
const expected = sim.result;
console.log(`swap ${wbt} WBT → ~${formatUnits(expected, 6)} USDT (pool fee ${fee}) → ${recipient}`);
const before = await publicClient.readContract({ address: deployment.token, abi: erc20, functionName: "balanceOf", args: [recipient] });
const hash = await wallet.writeContract({ address: ROUTER, abi: routerAbi, functionName: "exactInputSingle", args: [{ ...params, amountOutMinimum: (expected * 98n) / 100n }], value: amountIn });
const r = await publicClient.waitForTransactionReceipt({ hash });
const after = await publicClient.readContract({ address: deployment.token, abi: erc20, functionName: "balanceOf", args: [recipient] });
console.log(`${r.status === "success" ? "✓" : "✕"} ${r.status}: https://explorer.testnet.whitechain.io/tx/${hash}`);
console.log(`  recipient USDT ${formatUnits(before, 6)} → ${formatUnits(after, 6)}`);
