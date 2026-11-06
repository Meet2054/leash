# LEASH_STATUS — 2026-11-06T11:12+05:30 IST — milestone M8 (in progress: docs + deploy; M7 done with HBAR; World real-IdP run pending)

## 1. Summary (3 lines max)
Whitechain is live and verified: 300 x402 payments settled in 10 USDT claims, and Falcon-gated vault creation and cap raises are onchain. Hedera is live: 3 x402 `exact` payments settled through our facilitator (fee payer), one refusal above the approval threshold, and an HCS audit log. Settlement there is in **HBAR**, because the Circle USDC faucet stalled.
Open blockers (HUMAN): World IdP credentials (the real World check is so far **MOCKED**), and a hosting provider + DOMAIN (after the all-protocol test pass). Deadline: **2026-11-07 04:54 IST**, build cutoff **2026-11-06 22:54 IST**.

## 2. Gates
| Gate | Result | Evidence | Fallback taken |
|---|---|---|---|
| M2 (h4): real Falcon verify on Whitechain, off-chain-signed vector | **PASS** | Deployed `EthFalconVerifier 0x78Cd…B7cB` returns true for `contracts/test/vectors/falcon_leash.json`, false for a wrong digest; live txs `0x8229…d298`, `0x36e2…c1ab` verify Falcon onchain | none |
| M5 (h6): Falcon WASM signing in the browser | **PASS** | `apps/web/test/falcon-wasm.test.ts` (WASM signature verifies in the real ZKNOX verifier; tamper/wrong key → false) | none |
| h20: Whitechain + World complete end to end? | **Whitechain yes; World only with MOCKED issuer** | Scenario B deny/approve live on 1874 | M7 done anyway (Hedera via the §10 fallback design) |

## 3. Deployments
| Chain | Contract | Address | Verified? | Explorer link |
|---|---|---|---|---|
| Whitechain 1874 | ZKNOX_ethfalcon (ZKNox, MIT) | 0x4b92C21C389F46d5C6e7339ff3A83e509a91D2bB | ✅ | https://explorer.testnet.whitechain.io/address/0x4b92C21C389F46d5C6e7339ff3A83e509a91D2bB |
| Whitechain 1874 | EthFalconVerifier | 0x78CdF2C1597487Be1C61dD74C3388C45Dd31B7cB | ✅ | https://explorer.testnet.whitechain.io/address/0x78CdF2C1597487Be1C61dD74C3388C45Dd31B7cB |
| Whitechain 1874 | LeashFactory | 0x754180420d905DbE4A92990C39b22F7373393C66 | ✅ | https://explorer.testnet.whitechain.io/address/0x754180420d905DbE4A92990C39b22F7373393C66 |
| Whitechain 1874 | LeashVault (implementation) | 0x3B0E1F9450203a542f7DC644e58F5CDf13cDB306 | ✅ | https://explorer.testnet.whitechain.io/address/0x3B0E1F9450203a542f7DC644e58F5CDf13cDB306 |
| Whitechain 1874 | CLI vault (clone) | 0x3B77877490A4C2A89e55b94e969cae1fA190c392 | clone of verified impl | https://explorer.testnet.whitechain.io/address/0x3B77877490A4C2A89e55b94e969cae1fA190c392 |
| Hedera 296 | facilitator fee payer / HCS topic / agent / merchant (no contracts) | 0.0.11329302 / 0.0.11329753 / 0.0.11329481 / 0.0.11329482 | n/a | https://hashscan.io/testnet/topic/0.0.11329753 |

## 4. Live proof (most recent)
- Whitechain USDT claim tx: https://explorer.testnet.whitechain.io/tx/0x1ab1d35e4951ed44954ee461eab6fd20568f4f50d530e3869ff126e474a18514 | Scenario A total 300 paid calls → 10 claims (up to 100 vouchers per claim) | merchants +4.75 USDT, relayer fees 0.010 USDT
- Mandate loosening (approved) tx: https://explorer.testnet.whitechain.io/tx/0x36e2e14380f9fb673061803a10f3cc813f66cb85b5fb6b1b1e1a0ac577b6c1ab (cap 5 → 8 USDT; real Falcon signature; World check **MOCKED** issuer)
- Denied approval attempt id + reason: `a4a047c2-47bd-4b64-89bf-c707afd930ec` — "denied by the owner" → no attestation, no tx
- Hedera settled payment: https://hashscan.io/testnet/transaction/0.0.11329302@1793911532.195465156 (+ `…1533.673150092`, `…1538.419042992`); fee payer = our facilitator; **HBAR** | HCS topic: https://hashscan.io/testnet/topic/0.0.11329753 (5 messages: genesis, 3 settled, 1 refused `leash_human_approval_required`)

## 5. Tests
- forge: **75/75** passed (LeashVaultTest 63 incl. 4 new `test_trustSplit_*`, EthFalconTest 8, FalconE2ETest 3, Eip712VectorsTest 1). No failures.
- vitest: 42/42 passed (sdk 10, relayer 10, facilitator 18 = e2e 6 + breaker 7 + flight 5, web WASM-Falcon 4). No failures. `packages/hedera` has no unit tests yet (exercised live by `pnpm agent h`).
- Gas: openChannel 164,512 · claim ~101k avg onchain (≤ 93,360 in forge) · applyChange (real Falcon, loosening) 1,651,264 onchain · createVault (real Falcon) 1,898,270 onchain

## 6. Metrics
- Live (Whitechain): 300 vouchers / 10 claim txs (30× fewer txs) / 2,280 B claim calldata. Signature bytes vs PQ-per-payment: **115× less with Falcon on both sides**, 261× vs ML-DSA-44. At this small scale the two PQ owner actions dominate. Projection at scale: **~584× (Falcon both sides)**, ~876× vs ML-DSA-44.
- Relayer (Whitechain) WBT left: 1.633 (~180 Falcon-heavy ops, or many more claims). Hedera fee payer: 989.68 HBAR.

## 7. Prize checklists
**Whitechain**
- [x] Contracts deployed on 1874 and verified on Blockscout
- [x] ≥1 payment in USDT `0xcedf…55a7` settled in the main flow (10 claims, 300 payments)
- [x] README line on why onchain stablecoin settlement on Whitechain
- [x] Payer never holds WBT / seed phrase / picks a chain (agent WBT 0)
- [x] README: who pays gas, how the relayer gets WBT, what stops draining
- [x] Steady commit history (34 commits) · [x] README setup/architecture/limitations
- [ ] 2–4 min demo video (script ready) · [x] WHITECHAIN_FEEDBACK.md

**World**
- [~] Official World ID Agent Pass: device-grant integration written; **only exercised with the MOCKED issuer** (needs WORLD_CLIENT_ID/SECRET)
- [x] Full journey request → completion → backend validation → mandate loosened onchain (MOCKED issuer)
- [x] Denied / cancelled / expired path where nothing happens
- [x] Validation in a secure backend; device_code and secret never reach the browser
- [x] WORLD_DEBRIEF.md (real-IdP time-to-first-success still pending)

**Hedera**
- [x] x402 endpoint settling on Hedera testnet through our facilitator
- [x] Agent discovers and pays end to end with no human approving
- [x] README with Hedera transaction IDs + HashScan
- [ ] Demo video ≤5 min
- Extras: [x] spending controls · [x] human approval above a threshold · [x] HCS audit log · [ ] HTS USDC settlement (switch ready: `HEDERA_PAY_ASSET=usdc`; faucet didn't deliver)

**ETHGlobal general**
- [x] MIT · [x] AI usage disclosed · [x] steady commits · [ ] demo video · [ ] live demo link (deploy kit in progress) · [ ] repo public (HUMAN)

## 8. Known issues & risks (honest; include anything mocked or faked)
- **MOCKED World ID:** every World check so far used the local mock issuer (`WORLD_MODE=mock`). The real IdP device flow is coded but not yet run (no portal credentials).
- **CLI bootstrap vault:** its creation approval was signed by the attestor without a World check (`--attest local`). Labelled MOCKED.
- **Hedera settles in HBAR**, not USDC. The Circle faucet's Hedera sender made no payouts for over an hour during the event. On Hedera each paid request is a separate settlement (no batching), and the mandate is enforced by our facilitator, not onchain.
- **Agent session expiry:** the CLI session (`keys/agent-session.json`) expires 2026-11-07 00:08 IST. The demo will use a fresh web-onboarded vault and the `agent-session-demo` key.
- **Trust points:** the attestor key and the relayer/facilitator; state lives in local SQLite. Relayer and attestor are immutable in the factory (see README Limitations).
- **Secrets audit (2026-11-06 09:17 IST):** `gitleaks git --log-opts=--all` (gitleaks 8.30.1) over all 37 commits (~869 KB) found **1 finding, a false positive**: rule `generic-api-key` matched `"token": "0xcedf…55a7"` in `contracts/deployments/1874.json`, the public USDT contract address. It is listed with a comment in `.gitleaksignore`, and the re-scan reports **no leaks**. `git log --all -- .env keys/` → **0 commits** (neither path was ever committed). Only `.env.example` (placeholders) is tracked. A separate check confirmed none of the real `.env`/`keys/` private keys appear anywhere in history.
- No live hosting yet (services run on a laptop). **Deploy kit ready** (`deploy/`: Caddy HTTPS + pm2 + persistent volume, parameterized by DOMAIN; routing verified locally 8/8). Waiting on a provider + DOMAIN.
- Relayer and attestor are immutable in the factory: rotating either means a new factory. Existing vaults stay usable and merchants can self-claim without the fee.

## 9. Decisions since last report
- Hedera via x402 `exact` + facilitator-enforced mandate + HCS (spec §10 design), asset-configurable (`HEDERA_PAY_ASSET`). HBAR now, USDC when funded.
- Hedera operator rotated by the human to `0.0.11329302`; the audit topic was recreated (`0.0.11329753`) because HCS only accepts its submit key.
- Data math: lead with **~584× (Falcon both sides)**, ~876× vs ML-DSA-44 second (review 09:10).
- Full memory of the build: `docs/PROJECT_JOURNAL.md`.
- Two-key trust split stated in the README and proven in tests: the attestor alone can't loosen, and the PQ key alone can only tighten.
- Reproducible deploy record: `contracts/deployments/1874.json` (deploy txs, solc 0.8.25, cancun, ZKNox `43ac863`, deploy commit `b21410a`); the live bytecode of all 4 contracts exactly matches a local build (immutables masked).
- Review 09:10 items: 1 deadline placeholder (awaiting date) · 2 ✅ · 3 ✅ · 4 ✅ · 5 ✅ · 6 ✅ kit ready · 7 ⏳ World credentials · 8 ⏳ demo vault (after real World + hosting; fallback before 2026-11-07 00:08 IST).

## 10. Questions for the reviewer
1. What's the confirmed submission deadline (IST)? The backward plan in CLAUDE.md §14 is waiting on it.
2. Hosting provider + DOMAIN for the single-host deploy (`deploy/`)?

## 11. Commit log since last report (git log --oneline)
```
b17cd4d docs(memory): submission deadline placeholder + backward plan (review item 1)
aa22463 feat(hedera): asset-configurable Hedera endpoints; live HBAR settlements + HCS log
635bedc chore(hedera): switch to rotated operator 0.0.11329302, new HCS topic 0.0.11329753
caa3de8 feat(hedera): x402 exact on hedera:testnet via our facilitator + HCS audit log
47329d1 docs(status): tick README/feedback/debrief items, link project journal
38aa2ef docs: project journal — complete memory of the build (vision, taste, timeline, failures + root causes, runbook, human asks)
8d0e10a docs: Whitechain feedback, World debrief, 3:30 demo script; agent env overrides
44bf22f docs: first live USDT claims on Whitechain — 300 x402 payments in 10 claims
bdc81d8 fix(facilitator,sdk): one rate-limit token per paid request; resync client state on 402
```

## 12. Features F1–F7
| Feature | Status | Evidence | Tests |
|---|---|---|---|
| F1 PQ Ledger + Q-Day drill | ✅ done (rotation's World approval **MOCKED**) | PQ Ledger: 4 PQ-verified txs (~1.56M verify gas, 82–97% of tx gas); rotation https://explorer.testnet.whitechain.io/tx/0x1c4fc9b384bad46fdf5d319f62af0011fecf52da918ada3d2b51f3844279a784 · new-key tightening https://explorer.testnet.whitechain.io/tx/0x8543b2c0be8a95ff9a68ee32ed0c811218f5e4d07ed51061db6c51761f8f113e · retired key → `WrongPqKey` (simulated) | forge `test_rotatePqKey_oldKeyStopsWorking` |
| F2 circuit breaker (Scenario D) | ✅ done (facilitator-enforced) | Scenario D live: 20 workers cut off after 271 ms (velocity 151/10 s); HCS https://hashscan.io/testnet/topic/0.0.11329753 #11 `CircuitTripped`; Freeze all in the app + `pnpm owner freeze` | vitest 7 (breaker) |
| F3 reorg-safe settlement | ✅ done | batcher reconciles recent claims vs chain, rolls back + resyncs nonce + re-claims latest voucher; `ClaimReorged` audit event | vitest e2e "F3 reorg safety" (evm_snapshot/evm_revert) |
| F4 agent flight recorder | ✅ done | per-claim Merkle roots on HCS 0.0.11329753; `pnpm verify-log` → 3/3 match (claim https://explorer.testnet.whitechain.io/tx/0x158e0058f3bd3715287f07f66fe10f2d2c6202ff97dcb393a8b9f7c58843e2e0 …) | vitest 5 (tamper/delete detected) |
| F5 one human, one budget | P3 | — | — |
| F6 never-callable-by-session list | P3 (partly covered: `test_wrongPqPubKey_reverts_agentCannotChangeOwnMandate`, trust-split tests) | — | — |
| F7 Break-the-Leash arena | P3 | — | — |
