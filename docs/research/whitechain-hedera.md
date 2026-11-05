# Whitechain (1874) and Hedera (296) environment notes (verified 2026-11-05)

## Whitechain testnet — chain 1874 (OP Stack L2, custom gas token WBT)
- RPC `https://rpc.testnet.whitechain.io` (50 req/s per IP, burst 500, batch ≤ 100). Old testnet 2625 = ignore.
- Docs moved to https://docs.whitechain.io (llms.txt index). viem ships `whitechainSepolia`.
- 1 s blocks, 40M block gas, 5 gwei min base fee, L1 data fee on top (GasPriceOracle 0x420…0F; ≈0 measured), no per-tx gas cap on testnet (mainnet 1875 caps at 16,777,216).
- **WBT faucet**: https://faucet.testnet.whitechain.io — GitHub OAuth (account ≥ 30 days) + Cloudflare Turnstile → **2 WBT / 24 h** per address/IP/GitHub account. Not scriptable (captcha). HUMAN step.
- No ETH→gas route (CGT mode; bridged ETH is an ERC-20).
- **USDT `0xcedfB…55a7`**: TetherTokenV2 behind proxy, 6 dp, permit + EIP-3009. `mint` is onlyOwner (USDTBridge `0x8790…799c`). No public faucet. Builders are swapping WBT→USDT on an undocumented Uniswap V3 deployment:
  - wrap WBT → WWBT `0x4200000000000000000000000000000000000006`
  - SwapRouter02 `0xe208cC685cD95D56E8ec6DEC9816476567fc6962` (UniversalRouter `0xbCB198083504E31293bC3765b3c791cF2B2202d8`, factory `0x94aFa2aB80E44163362D2952bdf1E95b81900738`)
  - WWBT/USDT 0.3% pool `0x5645101Ca8d2F7BaBC27b10359555767a1BdF999` (~1.99 WBT → ~146.9 USDT observed)
  - Docs/token list mention another USDT `0xaa79…8f46` (USDT.e) — **not** the prize token.
- Verification (Blockscout, no API key): `forge verify-contract <addr> src/X.sol:X --rpc-url https://rpc.testnet.whitechain.io/ --verifier blockscout --verifier-url https://explorer.testnet.whitechain.io/api/` (trailing slash required). Pin solc + evm_version consistently. Confirm with `GET /api/v2/smart-contracts/<addr>`.

## Hedera testnet — chain 296
- Hashio `https://testnet.hashio.io/api` (relay 0.80.3), gas price ≈ 1,310 gwei (weibar). Mirror node `https://testnet.mirrornode.hedera.com`.
- Per-tx gas limit **15,000,000** (node + relay). eth_estimateGas rejects gas > 15M; set gas explicitly. Falcon verify ≈ 1.5M gas ≈ 2 HBAR.
- EIP-170 runtime limit, 49,152 initcode, 128 KB calldata on relay. Verify via Sourcify (`--verifier sourcify --chain-id 296`).
- **USDC**: HTS `0.0.429274` = EVM `0x0000000000000000000000000000000000068cda`, 6 dp. Circle faucet https://faucet.circle.com ("Hedera Testnet", 20 USDC / 2 h).
- **HTS association**: `0x167.associateToken(address,address) returns (int64)`; SUCCESS 22, ALREADY_ASSOCIATED 194. Failures don't revert — check the code. **From a delegatecall context (EIP-1167 clone initializer) the 0x167 call is rejected** (needs delegatable key) → use `IHRC719(token).associate()` from the clone instead. Observed: recently deployed contracts have unlimited auto-associations (-1), so incoming USDC may auto-associate. (Source-read, not tested live.)
- SDK: **`@hiero-ledger/sdk` 2.90.1** (successor to `@hashgraph/sdk`, which stopped at 2.81.0). `@x402/hedera` pins `@hiero-ledger/sdk 2.90.1`.
- HCS: `new TopicCreateTransaction().setTopicMemo(..).execute(client)` → receipt.topicId; `new TopicMessageSubmitTransaction().setTopicId(id).setMessage(msg).execute(client)`; read via mirror `/api/v1/topics/<id>/messages`. ≤1024 B per chunk.
- HashScan: `https://hashscan.io/testnet/topic/0.0.X`, `/transaction/<txId|evm hash>`, `/account/..`, `/token/..`.
- Accounts: https://portal.hedera.com (ECDSA testnet account, 1,000 HBAR); faucet https://portal.hedera.com/faucet (100 HBAR, no login). Env: `HEDERA_OPERATOR_ID=0.0.x`, `HEDERA_OPERATOR_KEY` (DER or hex ECDSA; same key usable on EVM).
