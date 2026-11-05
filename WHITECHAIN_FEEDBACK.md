# Whitechain feedback — Leash (ETHGlobal Mumbai 2026)

We built an x402 payment rail where AI agents pay per request through batched USDT payment channels on Whitechain testnet (chain 1874). The owner's root key is post-quantum (ETHFALCON, ~1.5M gas per onchain verify). Everything below comes from actually doing it. Times are IST, Nov 5–6.

## What worked well
- **The RPC is fast and modern.**
  - `https://rpc.testnet.whitechain.io` runs `op-reth`, has 1 s blocks, a 40M block gas limit, a 5 gwei base fee, and Cancun/Isthmus opcodes (PUSH0, TSTORE, MCOPY all fine).
  - We compiled with `evm_version = cancun` and nothing broke.
- **State overrides in `eth_call` / `eth_estimateGas` are supported.** This was the single most useful thing for us.
  - Before we had any WBT, we injected ZKNox's Falcon verifier bytecode with a state override and measured real verify gas on the live node: about 1.53M.
  - That de-risked our riskiest design decision in minutes, without deploying anything.
- **Blockscout verification worked first try** with `forge verify-contract --verifier blockscout --verifier-url https://explorer.testnet.whitechain.io/api/`. All 4 contracts verified, including the vault implementation that our factory deployed from its constructor.
- **Cheap enough for post-quantum.** A Falcon-checked vault creation costs 1.90M gas and a Falcon + attestation mandate change 1.65M, about 0.008–0.009 WBT each. The L1 data fee was effectively 0 on testnet.
- **Plain OP Stack predeploys and standard infra are present:** EntryPoint v0.7, the CREATE2 deployer `0x4e59…`, Multicall3 and GasPriceOracle. viem ships `whitechainSepolia`.
- **The prize token is well behaved.** USDT `0xcedf…55a7` is TetherTokenV2 behind a proxy, returns `bool`, and has permit + EIP-3009, so a standard SafeERC20 flow just works.
- **End result:** 300 x402 payments settled in 10 claim transactions (about 101k gas each), and the paying agent never held WBT.

## Where we got stuck
1. **Two testnets with near-identical hostnames.** `rpc-testnet.whitechain.io` returns chain **2625** (the legacy testnet), while `rpc.testnet.whitechain.io` returns **1874**. Our first probe hit the wrong one, and only checking `eth_chainId` caught it. A banner in the docs ("the hackathon chain is 1874; 2625 is legacy") would save every team this trap.
2. **There was no way to get the prize USDT.**
   - The prize requires `0xcedf…55a7`, but we found no faucet, form or booth flow for it.
   - `mint` is owner-only, with the owner being the USDT bridge.
   - Worse, the docs and token list point to a *different* USDT (`0xaa79…8f46`, "USDT.e"), so a team can easily fund the wrong token.
   - We ended up reading other builders' transactions onchain to discover an **undocumented Uniswap V3 deployment** (WWBT/USDT 0.3% pool `0x5645…F999`, SwapRouter02 `0xe208…6962`). We swapped 0.3 faucet WBT for 21.93 USDT straight into our vault. It worked, but it took detective work.
3. **The faucet can't be scripted.** It needs a GitHub OAuth login (account ≥ 30 days old) plus a Cloudflare Turnstile captcha, and pays 2 WBT per 24 h. That's reasonable for abuse control, but an agent-driven or CI setup can't top up a relayer. The docs page still says 0.5 WBT and mentions a mainnet-balance requirement; the live API says 2 WBT and the requirement seems gone.
4. **Docs moved.** `l2docs.whitechain.io` is gone (NXDOMAIN) and search results still point at it. The new site (`docs.whitechain.io`, with `llms.txt`) is good once you find it.
5. **There's no ETH → gas path** (custom-gas-token mode). Bridged ETH arrives as an ERC-20. That's fine, but worth one sentence in the gas docs, because teams coming from other OP chains will assume they can bridge ETH for gas.

## What the docs were missing
- One **"testnet contract addresses"** page: WWBT, Uniswap V3 (factory, router, quoter, main pools), Multicall3, EntryPoint, the CREATE2 deployer, the USDT bridge.
- **Stablecoin distribution for builders:** which USDT is canonical on 1874, and how to get it (faucet, swap, or ask). This is the #1 thing a "payments" track needs.
- A note that **state overrides work on the public RPC**. Most teams won't know, and it's very useful.
- **Gas sponsorship guidance:** EntryPoint v0.7 is deployed, but we found no bundler or paymaster endpoints. We built our own relayer instead (simulate-before-send, budgets, allowlist) and explain the anti-drain design in our README.
- The **mainnet per-transaction gas cap (16,777,216)** versus no cap on testnet should be stated next to each other, because anything heavy (like PQ verification) needs to know.

## Suggestions
- A tiny "hackathon kit" page: the chain ID, the RPC, the faucet, how to get the prize USDT, the DEX addresses, and the verify command.
- Consider a USDT drip (even 10 USDT/day) next to the WBT faucet for registered hackathon teams.
- Consider a rate-limited faucet API key for teams running relayers, so bots don't need captchas.

Thank you. The chain itself was a pleasure to build on, and verification plus state overrides were genuinely better than on many larger L2s.
