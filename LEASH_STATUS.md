# LEASH_STATUS — 2026-11-06T00:45+05:30 IST — milestone M3 (done)

## 1. Summary (3 lines max)
Contracts (vault, factory, ETHFALCON adapter) are deployed and verified on Whitechain 1874. Real Falcon signatures are verified onchain in live txs (vault creation + a World-approved cap raise). The x402 `leash-batch` stack (SDK, relayer, facilitator, merchant, agent) runs green end to end on anvil and live on 1874, waiting for USDT. The owner app + World attestor work with a **MOCKED** World issuer. In-browser Falcon (WASM) passes the gate.
Blocked on HUMAN: USDT into the vault, World IdP portal credentials, Hedera account.

## 2. Gates
| Gate | Result | Evidence | Fallback taken |
|---|---|---|---|
| M2 (h4): real Falcon verify on Whitechain with an off-chain-signed vector | **PASS** | Deployed `EthFalconVerifier 0x78Cd…B7cB` returns `true` for `contracts/test/vectors/falcon_leash.json` (signed by `tools/owner-signer`), `false` for a wrong digest, ~1.58M gas; live txs `0x82290b8e…d298` (createVault) and `0x36e2e143…c1ab` (applyChange) verify Falcon onchain | none |
| M5 (h6): Falcon WASM signing in the browser | **PASS** | `apps/web/test/falcon-wasm.test.ts`: WASM signature verifies in the real ZKNOX_ethfalcon verifier, tampered/wrong-key → false, fresh salt per signature | none (localhost Python signer kept as an alternative) |
| h20: Whitechain + World complete end to end? | not yet reached | — | — |

## 3. Deployments
| Chain | Contract | Address | Verified? | Explorer link |
|---|---|---|---|---|
| Whitechain 1874 | ZKNOX_ethfalcon (ZKNox, MIT) | 0x4b92C21C389F46d5C6e7339ff3A83e509a91D2bB | ✅ | https://explorer.testnet.whitechain.io/address/0x4b92C21C389F46d5C6e7339ff3A83e509a91D2bB |
| Whitechain 1874 | EthFalconVerifier | 0x78CdF2C1597487Be1C61dD74C3388C45Dd31B7cB | ✅ | https://explorer.testnet.whitechain.io/address/0x78CdF2C1597487Be1C61dD74C3388C45Dd31B7cB |
| Whitechain 1874 | LeashFactory | 0x754180420d905DbE4A92990C39b22F7373393C66 | ✅ | https://explorer.testnet.whitechain.io/address/0x754180420d905DbE4A92990C39b22F7373393C66 |
| Whitechain 1874 | LeashVault (implementation) | 0x3B0E1F9450203a542f7DC644e58F5CDf13cDB306 | ✅ | https://explorer.testnet.whitechain.io/address/0x3B0E1F9450203a542f7DC644e58F5CDf13cDB306 |
| Whitechain 1874 | Demo vault (clone) | 0x3B77877490A4C2A89e55b94e969cae1fA190c392 | clone of verified impl | https://explorer.testnet.whitechain.io/address/0x3B77877490A4C2A89e55b94e969cae1fA190c392 |
| Hedera 296 | — | not deployed | — | — |

## 4. Live proof (most recent)
- Whitechain USDT claim tx: https://explorer.testnet.whitechain.io/tx/0x1ab1d35e4951ed44954ee461eab6fd20568f4f50d530e3869ff126e474a18514 | first batch | Scenario A total: 300 paid calls → 10 claims (max 100 vouchers/claim), merchants +4.75 USDT, fees 0.010 USDT
- Vault funding: 0.3 faucet WBT swapped → 21.93 USDT straight into the vault (https://explorer.testnet.whitechain.io/tx/0x9eab9b3e9c09448a1cdf675640c5e02da0091360289024fb8944ce556e9eacb9)
- Vault creation with an onchain Falcon check: https://explorer.testnet.whitechain.io/tx/0x82290b8eddfaba7b3ed963520edb0c0bbab77fe3eeb1297fb4a34dd27853d298 (World approval **MOCKED**: CLI bootstrap, attestor signed without a World check)
- Mandate loosening (approved) tx: https://explorer.testnet.whitechain.io/tx/0x36e2e14380f9fb673061803a10f3cc813f66cb85b5fb6b1b1e1a0ac577b6c1ab (cap 5 → 8 USDT; real Falcon signature; World check **MOCKED** issuer, validated by the same backend code path)
- Denied approval attempt id + reason: `a4a047c2-47bd-4b64-89bf-c707afd930ec` — "denied by the owner" → no attestation, no tx, cap unchanged (5 USDT)
- Scenario C: attacker opening a channel to an unlisted address → HTTP 422 `MerchantNotAllowed` from simulation, never broadcast
- Hedera claim tx / HashScan: not started | HCS topic: not created

## 5. Tests
- forge: 71/71 passed (LeashVaultTest 59, EthFalconTest 8, FalconE2ETest 3, Eip712VectorsTest 1). No failures.
- vitest: 29/29 passed (sdk 10, relayer 10, facilitator e2e 5, web WASM-Falcon 4). No failures.
- Gas: openChannel 164,512 · claim ≤ 93,360 · applyChange (real Falcon, loosening) 1,651,264 onchain · createVault (real Falcon) 1,898,270 onchain · EthFalconVerifier.verify ~1.52M in-EVM

## 6. Metrics
- vouchers served 300 / claim txs 10 (30× fewer txs) / avg claim calldata 228 B, ~101k gas / signature bytes 261× less than ML-DSA-per-payment at this small scale (PQ owner actions dominate; projection at scale ≈ 876×)
- relayer WBT left 1.634 (after 0.3 WBT swap + ops)

## 7. Prize checklists (copy §3 with current ticks)
**Whitechain**
- [x] Contracts deployed on 1874 and verified on Blockscout
- [x] ≥1 payment in USDT `0xcedf…55a7` settled in the main flow (10 claims, 300 payments)
- [ ] README line on why onchain stablecoin settlement on Whitechain
- [x] Payer (agent) never holds WBT / seed phrase / picks a chain (agent WBT balance 0; demo shown in `pnpm agent a` output)
- [ ] README: who pays gas, how the relayer gets WBT, what stops draining (implemented: simulate-before-send, budgets, rate limits, allowlist, auto-pause; write-up pending)
- [x] Steady commit history (22 commits so far) · [ ] README setup/architecture/limitations
- [ ] 2–4 min demo video · [ ] WHITECHAIN_FEEDBACK.md

**World**
- [~] Official World ID Agent Pass: device-grant integration written against auth.world.org docs; **only exercised with the MOCKED issuer** so far (needs portal credentials)
- [x] Full journey request → completion → backend validation → protected action executes (mandate loosened onchain) — with MOCKED issuer
- [x] Denied / cancelled / expired path where nothing happens (owner deny verified live; World cancel/expire paths implemented and unit-exercised via mock)
- [x] Validation in a secure backend, no client secrets, device_code never sent to the browser, unvalidated client data never authorizes
- [ ] WORLD_DEBRIEF.md

**Hedera**
- [ ] all items (M7 not started; plan: `exact` scheme via @x402/hedera + HCS audit log)

**ETHGlobal general**
- [x] MIT license · [x] AI usage disclosed (README stub) · [x] steady commits · [ ] demo video · [ ] live demo link · [ ] repo public (HUMAN)

## 8. Known issues & risks (honest; include anything mocked or faked)
- **MOCKED World ID:** every World check so far used the local mock issuer (`WORLD_MODE=mock`). The real World IdP device flow is coded but untested.
- **CLI bootstrap vault:** its creation approval was signed by the attestor key without any World check (`--attest local`). It is labelled MOCKED in logs and in `keys/vault-1874.json`.
- Hedera port not started. Planned path: x402 `exact` scheme with our facilitator + HCS log. Known issue: our vault's HTS association uses 0x167 from a clone (delegatecall), which Hedera likely rejects; switch to `IHRC719.associate()` if we deploy vaults there.
- The facilitator and attestor are trust points (documented in the trust model). Data lives in local SQLite, so a restart keeps state but there is no replication.
- The deployed app is not live yet. Services run on a laptop.

## 9. Decisions since last report
- World integration uses the IdP device grant; action binding is server-side (the IdP has no binding_message/CIBA).
- Hedera primary path = spec §10 fallback (`exact` + HCS) because of time.
- In-browser Falcon: ZKNox C compiled with `-DETHFALCON` plus our CSPRNG `randombytes` (their JS build uses SHAKE + the deterministic KAT RNG, so it was unusable).
- Spec deviations (cooperativeClose voucherSig, RevokeSession type, relayer immutable, default-verifier-only creation, MAX_AUTH_AGE) are listed in CLAUDE.md §14.
- Data math: show both baselines (ML-DSA-44 ≈ 876×, Falcon both sides ≈ 584×).

## 10. Questions for the reviewer
1. Is the MOCKED World issuer acceptable for the demo if portal credentials or a sandbox World ID can't be obtained in time? (The real path is coded.)
2. Is Hedera via the `exact` scheme + HCS log enough, or should we port the vault EVM contracts to 296?

## 11. Commit log since last report (git log --oneline)
```
cb21ff2 feat(owner-cli): scripted owner decisions (approvals/deny/approve) via the attestor API
9c9498d feat(web): owner app (onboard, mandate, approvals, activity, stats) + World attestor
978d7b9 feat(web): in-browser ETHFALCON-512 owner key via WASM (gate M5 pass)
8399dfb feat(agent): scripted demo agent — scenario A (discover + pay), B (Cornell replay), C (leaked key)
c3bc05b feat(owner-cli): Falcon-keyed owner CLI + facilitator/merchant service entrypoints
e2cb6b4 chore(deploy): Leash on Whitechain testnet 1874, verified on Blockscout
a61ebbc feat(facilitator): leash-batch x402 facilitator, channel engine, batcher, relay API
b21410a feat(relayer): simulate-then-send hot key with nonce mutex, replacement, budgets
b4f890f feat(sdk): leash-batch x402 scheme client/server, session signing, loosening requests
d48ce8b feat(sdk): EIP-712 types, digests, mandate action encoders, generated ABIs
d9c5ee0 docs: Whitechain faucet/USDT/verification and Hedera limits research
64c9662 feat(contracts): deploy script for ETHFALCON verifier + factory, Blockscout verify
4e26a8c docs: research notes for x402 v2 and World IdP (Agent Pass)
569e021 test(contracts): gate M2 cross-check, off-chain Falcon sigs verify on-chain
e7fd891 feat(owner-signer): ETHFALCON-512 signer CLI + localhost service
2312815 chore(contracts): save forge gas report
3d86606 test(contracts): spec 6.4 suite, real ETHFALCON vectors, reentrancy and fuzz
7622a82 feat(contracts): LeashVault, LeashFactory, EIP-712 types and ETHFALCON adapter
319f77f build(contracts): foundry project with OZ v5.4, forge-std and ZKNox ETHFALCON pinned
5bcb7b8 chore: scaffold monorepo with spec, license and env template
```
