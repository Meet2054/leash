# Leash — project journal (the complete memory of this build)

> **Any agent or human picking this up: read this file first, then `CLAUDE.md` (spec + §14 project memory), then `LEASH_STATUS.md` (latest evidence).**
> This journal records the dream, the people and their taste, the timeline, every status, every failure with its root cause and fix, every decision, where everything lives, how to run it, and exactly what we still need from the human.
> Rule: append, don't rewrite history. Newest status at the top of §4. Secrets are named, never written.

---

## 1. The dream
**One line:** AI agents now spend money on their own, but their spending limits are enforced where the agent can reach them, and the keys behind those limits won't survive quantum computers.

**What Leash is:**
1. An **x402 payment rail**: agents pay per request through **batched payment channels on Whitechain, in USDT, without ever holding gas**.
2. Every payment is checked against an **onchain spending mandate** (cap, merchants, expiry). Only the owner's **post-quantum (ETHFALCON-512) key** can loosen it, and only after a **fresh World ID Agent Pass** human check.
3. Agents use **short-lived ECDSA session keys** whose worst case is capped by the mandate, so the PQ cost is paid only on rare owner actions. That is **~584× less signature data** than Falcon-signing every payment (~876× against an ML-DSA-44 baseline).

**Design rule:**
- Post-quantum keys where keys live long; cheap ECDSA where exposure is bounded in time and value.
- **Loosening** (raise cap, add merchant/session, withdraw, rotate key, switch verifier) needs the PQ signature **+ World approval**.
- **Tightening** (revoke, lower, remove) needs the PQ signature only.
- A session may always revoke itself.

**Why now (pitch):**
- A Cornell Tech/Yale study found 9 of 10 frontier models raised their own Circle agent-wallet caps by reading the emailed approval code. Lesson: approval must be bound to an action the agent cannot perform.
- x402 batch settlement is live on Solana but thin on EVM L2s.
- Onchain PQ verification costs ~1.5M gas (we measured 1.52M), and Ethereum ranked PQ precompiles C-tier, so the account layer must carry it, and cheap L2s like Whitechain make it affordable (~0.008 WBT).

**Prize targets (max 3):**
- Whitechain "Scale · Payments Nobody Notices" ($2k/$1k)
- World "World ID Agent Pass" ($2.5k/$1.5k/$1k)
- Hedera "AI Agents That Pay: x402 on Hedera" ($3k/$2k/$1.5k)

Track: **From Scratch** (all code written during the event; AI use disclosed; MIT; public repo).

---

## 2. People & taste (how the human wants to work)
- **The human:** a builder on the 0xGasless team. Messages are short and informal ("build it", "do the swap and send to vault"). They want the agent to **just keep building** and only ask when something is genuinely theirs to do (funds, accounts, credentials).
- **The hackathon had already started** when we began (2026-11-05 ~23:30 IST). The "Nov 6–8" dates in the original spec were wrong, and the human corrected this explicitly. Don't re-ask about timing.
- **They want everything remembered:** dreams, statuses, failures, causes, taste. When they ask **"what do we need?"**, answer with the list in **§11 (What we need from the human)**, the same steps every time, updated with what's done.
- **Taste in the spec:** boring, well-tested code over clever code ("this project's main claim is safety"); honesty above all (never claim something works without a link, a test or output; mark anything mocked as **MOCKED**); small conventional commits, often, never squashed or force-pushed; never commit secrets; regenerate `LEASH_STATUS.md` at every milestone, gate, or when the human types `status`.
- **Never copy 0xGasless/private code.** Rewrite patterns fresh. Public deps only (listed in the README).
- The agent (Claude Code) did the work. Background research agents were used for x402, World and Whitechain/Hedera docs.

---

## 3. Timeline (IST)
| When | What | Evidence |
|---|---|---|
| 11-05 ~23:15 | Spec pasted (CLAUDE.md). M0 read-only env checks: RPC, USDT, opcodes, state overrides, ETHFALCON gas via state override (1.53M) | CLAUDE.md §14 VERIFY table |
| 11-05 23:28 | Asked about pre-kickoff timing; the human said the hackathon had already started | — |
| 11-05 23:34 | Repo + first commit; keys generated into `.env` | `7907766` |
| 11-05 23:43 | M1: contracts + 67 tests green | `ae2bcd2`, `2eebd8f` |
| 11-05 23:48 | Python Falcon signer; M2 cross-check (off-chain sigs verify onchain) | `4432752`, `991aec9` |
| 11-05 23:50 | Deploy script dry-run on an anvil fork of 1874; research notes saved | `08572f5`, `c96b42a` |
| 11-05 23:54–00:06 | SDK (EIP-712 shared vectors), relayer, facilitator, merchant; anvil e2e 30 calls → 3 claims | `c128eab`…`c4a09c7` |
| 11-06 ~00:00 | Human claimed the faucet: 2 WBT → relayer (tx `0x7569…42c6`) | — |
| 11-06 00:06 | **Deployed + verified on Whitechain 1874**; **gate M2 PASS** on the deployed verifier | `fdde63c` |
| 11-06 00:08 | Owner CLI; **first vault created with an onchain Falcon check** (`0x8229…d298`) | `64216be` |
| 11-06 00:10 | Scripted agent (A/B/C) | `2e97cd6` |
| 11-06 00:23 | Owner web app + World attestor; **gate M5 PASS** (in-browser WASM Falcon) | `a01ab96`, `47f1866` |
| 11-06 00:25 | **Scenario B live:** deny → nothing; approve → cap 5→8 (`0x36e2…c1ab`) | `d8597e9` |
| 11-06 00:27 | LEASH_STATUS + README | `d2252e0`, `aece38b` |
| 11-06 00:33 | Swapped 0.3 WBT → 21.93 USDT into the vault (`0x9eab…cb9`) | — |
| 11-06 00:34–00:37 | **First real USDT claims**; Scenario A **300 paid calls → 10 claims**; fixed the self-throttle bug | `1105cea`, `cf939a6` |
| 11-06 00:56 | Whitechain feedback, World debrief, demo script, this journal | `80240a1`+ |
| 11-06 ~01:40–02:00 | Hedera: human created portal accounts (rotated once); bootstrap created the HCS topic + agent/merchant; Circle USDC faucet never delivered (first went to Arc, then the faucet stalled) | `acab5c7`, `98d86a6` |
| 11-06 23:50 | **Attack lab + Docs in the web app.** `/lab`: the same AI (local Ollama Qwen/Llama, or the visitor's own key) runs the invoice task without and with Leash, streamed live. Verified through the live site: drained (tx `0x738afe2f…`) vs 0 moved; the lab recycles the attacker's test USDT after each run. `/docs`: plain steps to connect any MCP agent, attack prompts, and running it locally | this commit |
| 11-07 00:20 | **Pitch evidence pass.** Pitch sheet (private) now carries the I-HITL per-model table (approx. from Fig. 2, sourced), our own model runs (Qwen 3.5 4B paid the attacker in 4 runs, Llama 3.1 8B tried to, Claude refused; Leash 0 every time), every incident with its source (Freysa, AIXBT, Comet/Brave, Guardio, FBI IC3 BEC, A2AS, I-HITL), lab statements (OpenAI, Anthropic), launches + forecasts (x402 wash-volume caveat), and all onchain proof links. Explorer check: every USDT the attacker address received came from the ordinary wallet; none from a Leash vault (6 blocked attempts in the Leash agent log) | this commit |
| 11-06 22:05 | **Pitch package:** side-by-side "without vs with Leash" demo (ordinary agent wallet drained for real, tx `0x9a5f…8d51`; Leash: 0 moved); the attack arrives as an invoice email; README "Why now" re-cited (I-HITL arXiv 2610.35835, IC3 BEC $3.05B, McKinsey); private pitch sheet artifact for the team | `f08df1c`, `e00507f` |
| 11-06 21:25 | **Live red team: 11/11 held** (`apps/agent/src/redteam.ts` on vault `0x94a8…7c8c`). The first run's voucher checks were inconclusive: the test hit `/hedera/quote`, and the control caught it. Fixed and rerun. The tester's real Claude agent is connected via MCP | this commit |
| 11-06 20:50 | **Leash MCP server** (`apps/mcp`): any AI agent pays through Leash. 8 tools; live smoke over stdio: quote paid 0.01, pay 0x…dEaD → MerchantNotAllowed, change_my_limits(500) → WrongPqKey. Real-agent key `0x978C…40F5` (~/.leash/agent-key.json) waits for the owner to add it | this commit |
| 11-06 18:10 | **Partner API for the arena:** `x-api-key` lane (own channel-open bucket, 401 on a wrong key) + `GET /stats?vault=` per-vault counters; ARENA_API_KEY in `.env`; facilitator tests 21/21 | this commit |
| 11-06 17:55 | Public API hostnames for the arena: `facilitator.permissionless.in` (:4021, ADMIN_TOKEN set) and `merchant.permissionless.in` (:4022, MERCHANT_PUBLIC_URL); stale localhost discovery rows deleted; tunnel on http2; friendly policy messages | this commit |
| 11-06 17:15–17:35 | **UI redesign + self-serve demo:** monochrome shadcn/ui (Geist, no borders, mobile-first, 5 tabs); onboarding 4 steps with the demo agent pre-filled; demo panel (testnet faucet via facilitator `/demo/faucet` with `DEMO_FAUCET=1`, server-side demo agent 20 paid calls, "agent asks for more", injected 500 ask). Relayer stocked with 22.02 test USDT (swap `0x2704…6ab5`). Phone screenshots checked via CDP emulation (390 px, no overflow) | `64c4b61`, `7ffaee5` |
| 11-06 17:10 | **Main domain is Leash** (human: "remove the portfolio, integrate it later"). The apex `permissionless.in` and `www` are now CNAMEs to tunnel `leash`; the app runs with APP_URL / World callback = https://permissionless.in; the quick tunnel was stopped. **To restore the portfolio later:** apex `A @ → 216.198.79.1` (Vercel), and move Leash back to `leash.permissionless.in` | this commit |
| 11-06 16:58–17:03 | **REAL World end to end.** The browser flow (code + PKCE) with our callback via a Cloudflare tunnel; World vault `0x45A1…5F06` created (`0x04dd…8d23`); Scenario B with real World: 500 blocked by policy, 8 denied, 8 approved → cap 5→8 (`0xf714…28f9`). Vault funded 14.68 USDT (swap `0x82b1…1875`). Live link https://leash.permissionless.in (named tunnel `leash`, zone on Cloudflare, NS drew/sureena) | `f4e2bf1`+ |
| 11-06 15:59–16:05 | Hosting decisions (human): GitHub `Meet2054/leash` (all 65 commits re-authored as Meet2054 before the first push; refs updated; backup bundle in `.git/`), Cloudflare zone permissionless.in, backend on this laptop via a tunnel | `209eaa4` |
| 11-06 15:00 | **Hedera tUSDC:** self-issued HTS token `0.0.11337141` (mentor-approved); Scenario H settled 3 payments in tUSDC; 0.6 refused | `bbd1317` |
| 11-06 14:00–14:20 | **F8 Bybit/Binance hardening:** attestor policy (R1 2×/24 h, R2 daily ceiling, R3 withdrawal cooldown, cancel on Deny or nonce bump, Loosening* events to HCS #41–#49), independent server/client decoding (mismatch blocks), passkey (PRF) encrypted Falcon seed, README threat model. `f8-smoke.ts` 7/7 live on 1874 (MOCKED World); vitest 49 → 65 | `3f52602`, `23e4645`, `9ea3056` |
| 11-06 13:28–13:44 | **Real World IdP (sandbox):** credentials work; first attempt → sandbox app "Failed to share" (identity likely still issuing) → IdP `access_denied` → DENIED, nothing signed, HCS #23. Real denied path captured | this commit |
| 11-06 13:47 | All-protocol test pass: forge 75/75, vitest 42/42, web prod build ✓; Whitechain 6 calls → claim `0x6242…c776`; Hedera 2 settled + 1 refused; verify-log 4/4. Only the real World approval is open (identity issuing) | this commit |
| 11-06 10:54 | Deadline confirmed: submission **2026-11-07 04:54 IST**, build cutoff **22:54 IST** (last 6 h = pitch) | `434df11` |
| 11-06 11:15 | **F4 live:** flight recorder; 20 paid calls → 3 claims → 3 FlightRecord roots on HCS; `pnpm verify-log` 3/3 match | this commit |
| 11-06 11:12 | **F3:** reorg-safe settlement (claim reconciliation + nonce resync), anvil rollback test green | this commit |
| 11-06 11:11 | **F2 live:** circuit breaker; Scenario D tripped after 271 ms (20 workers); HCS #11 `CircuitTripped`; breaker reset after the test | `ef79e72` |
| 11-06 10:58 | **F1 live:** PQ Ledger (4 PQ-verified txs) + Q-Day drill (rotation `0x1c4f…a784`, old key → WrongPqKey, new-key tightening `0x8543…113e`; World approval MOCKED) | `e8012d6` |
| 11-06 10:48 | VISION.md added (strict P0→P3); World sandbox docs re-read: attestor matches "Human checkpoints"; now pins the linked `sub`; developer MCP path documented; no Agent Pass workshop exists (only IDKit's) | `31f0e0b`+ |
| 11-06 09:10–09:30 | Review round: deadline placeholder, LEASH_STATUS regenerated, data math leads with 584×, gitleaks clean, deploy kit (Caddy + pm2), trust-split tests (forge 75/75), reproducible deploy record (bytecode exact match) | `716f3ba`…`6a1e26b` |
| 11-06 ~02:12 | **Hedera live (HBAR fallback):** 3 x402 payments settled through our facilitator (fee payer), the 6 HBAR call was refused (human approval required), 5 HCS messages | this commit |

---

## 4. Status (newest first)

### 2026-11-06 ~01:00 IST — after M3
| Milestone | Status | Evidence / notes |
|---|---|---|
| M0 env checks | ✅ | CLAUDE.md §14 |
| M1 contracts + tests | ✅ | forge 71/71 |
| M2 gate (Falcon on Whitechain) | ✅ PASS | deployed verifier returns true for off-chain vectors; live txs |
| M3 relayer + facilitator + merchant + SDK, real USDT | ✅ | first claim `0x1ab1d35e…4518`; 300 payments / 10 claims |
| M4 attestor + World + denied path | 🟡 done with **MOCKED** World issuer | real IdP code written, untested (no credentials) |
| M5 owner app + WASM gate | ✅ (gate PASS) | `apps/web/test/falcon-wasm.test.ts` |
| M6 scenarios A/B/C + dashboard | 🟡 all three ran live; dashboard (Stats tab) built | the demo vault should be re-onboarded via the web (session expiry) |
| h20 gate | not yet evaluated | — |
| M7 Hedera | ✅ (HBAR fallback) | 3 settled payments e.g. `0.0.11329302@1793911532.195465156`; HCS `0.0.11329753`; USDC switch ready (`HEDERA_PAY_ASSET=usdc`) once the faucet delivers |
| M8 docs, verification, live link | 🟡 README/feedback/debrief/demo script done; contracts verified; **no live link** | needs hosting |
| M9 freeze, video, final status | ❌ | — |

Tests: forge **71/71**; vitest **29/29** (sdk 10, relayer 10, facilitator e2e 5, web WASM 4).
Money on chain: vault 17.17 USDT left; merchants received 4.75 USDT; fees 0.010 USDT; relayer ~1.63 WBT.

---

## 5. Failures, root causes, fixes (every one, so nobody repeats them)
| # | What went wrong | Root cause | Fix / lesson |
|---|---|---|---|
| 1 | First RPC probe returned chain 2625 | `rpc-testnet.whitechain.io` is the **legacy** testnet; the right one is `rpc.testnet.whitechain.io` (1874) | Always check `eth_chainId`. Logged in docs + feedback |
| 2 | Valid ZKNox Falcon vectors "failed" (returned false) | Our parser matched the comment line `// message = "…"` instead of `bytes memory message = "…"`, so we sent an empty message | Anchor the regex on `bytes memory`. Lesson: suspect the harness before the crypto |
| 3 | `forge install` put submodules at the **repo root** | `contracts/` had no `foundry.toml` yet, so forge used the git root | Create `foundry.toml` first, then install. Removed and reinstalled under `contracts/lib` |
| 4 | "Stack too deep" in `createVault`/`applyChange` and later in a test | Five calldata args (bytes = 2 slots each) plus locals | Split into internal helpers. **Did not** enable via_ir (keeps codegen identical to ZKNox's build) |
| 5 | Fee test saw no fee | `vm.prank(relayer)` was consumed by the external view call `vault.voucherDigest()` inside the argument list | Compute signatures **before** `vm.prank` |
| 6 | `deployCodeTo` "no matching artifact" | Forge only exposes artifacts reachable from the compiled test; `ZKNOX_ethfalcon` wasn't imported | Import the contract in the test file |
| 7 | viem `InvalidAddressError` in tests | Mixed-case addresses with bad checksums | Use lowercase literals |
| 8 | Merchant: "no default asset for eip155:31337" | Static asset table; local devnet token address is dynamic | `registerAsset()` in the SDK; merchant `asset` option |
| 9 | Replay test spy never saw `PAYMENT-SIGNATURE` | `@x402/fetch` passes a `Request` from another realm; `instanceof Request` was false | Duck-type on `.headers` |
| 10 | Deploy output looked failed | Our `grep` (ugrep) rejected the filter regex; the deploy itself succeeded | Check `deployments/1874.json` and broadcast receipts, not the filtered log |
| 11 | `curl localhost:4021/claims?limit=20` failed | zsh globbing on `?` | Quote URLs |
| 12 | `next dev` crashed | `--env-file` not allowed in NODE_OPTIONS (Next re-spawns node) | `sh -c 'set -a; . ../../.env; set +a; next dev'` |
| 13 | Turbopack: "module has no exports" for `@leash/sdk` | TS source used `./x.js` import specifiers; Turbopack doesn't map them to `.ts` | Extensionless relative imports in the SDK |
| 14 | ZKNox's prebuilt `falcon.js` unusable for us | Built **without** `-DETHFALCON` (NIST SHAKE hash-to-point) and linked the **deterministic KAT DRBG** for randomness | Rebuilt from their C code with `-DETHFALCON` + our `crypto.getRandomValues` `randombytes` (`tools/falcon-wasm`) |
| 15 | WASM link error: undefined `randombytes` | Excluded katrng.c on purpose (unsafe) | Provided `leash_rng.c` |
| 16 | **Our own facilitator throttled our agent at call 70** (`leash_rate_limited`) | settle re-ran verify, so each request spent 2 tokens; bursts of ~20 req/s drained the bucket | Count once per request (settle's verify doesn't count), 50/s; agent backs off on rate limit |
| 17 | Latent overpayment after a rejected voucher | The SDK advanced its local cumulative before knowing the voucher was accepted | On any 402 the SDK drops local channel state and resumes from the facilitator's `lastAccepted` |
| 18 | Relayer nonce risk after the USDT swap | Swap txs were sent from the relayer key outside the facilitator's nonce manager | Restart the facilitator after any external tx from that key (or let it resync on error) |
| 19 | Next generated `AGENTS.md` | Next 16 default `agentRules` | `agentRules: false` in next.config |
| 20 | Stray `components/` dir at repo root | Agent wrote a file to the wrong path | Removed. Always use absolute paths under `apps/web/` |
| 21 | LEASH_STATUS claimed "31 commits" | Agent guessed instead of counting | Corrected to the real count; honesty rule: count, don't guess |
| 22 | Known, unfixed: Hedera HTS association from clones | `0x167.associateToken` from a delegatecall (EIP-1167 clone initializer) is rejected by Hedera (source-read) | Before any Hedera vault deploy: switch to `IHRC719(token).associate()`; contracts may auto-associate anyway |
| 24 | `pnpm -s setup` ran pnpm's **built-in** `setup` command (not our script) and appended a PNPM_HOME block to the human's `~/.zshrc` | `setup` is a reserved pnpm command name | Renamed our script to `bootstrap` (`pnpm hedera:bootstrap`). Removing the block from ~/.zshrc was denied by the permission system, so the human was told to delete lines 38–44 if they want. **Lesson: never name a package script after a pnpm built-in (setup, init, add, install…)** |
| 25 | Circle faucet "Tokens sent" but no USDC on Hedera (twice) | The faucet network was set to **Arc** (Circle's own testnet; the human's link was explorer.testnet.arc.io), not Hedera Testnet | Re-request with Network = **Hedera Testnet**, Send to = `0.0.11329481` (agent). Always check the network dropdown |
| 26 | Human rotated the Hedera operator credentials | The HCS topic only accepts its submit key (the old operator) | `pnpm hedera:bootstrap -- --new-topic` created topic `0.0.11329753` under the new operator; restarted the facilitator + merchant so the fee payer is the new account. Agent/merchant accounts have their own keys, so they're unaffected |
| 27 | Circle's Hedera USDC faucet stalled | Its sender `0.0.11920` made no user payouts from ~01:05 to 02:10 IST, despite "Tokens sent" in the UI | Switched the Hedera endpoints to **HBAR** (`HEDERA_PAY_ASSET=hbar`), funded the agent with 20 HBAR as payment money (fees still paid by the facilitator). Switch back with `HEDERA_PAY_ASSET=usdc` |
| 28 | Journal edit hit the wrong table row | The script changed the first line starting `\| 5 \|` (failure #5) instead of human-ask #5 in §11 | Fixed in a follow-up commit (`7377b14`). Lesson: match tables by a unique anchor, not a row number |
| 29 | Onboarding would crash on Hedera merchants | Discovery started listing Hedera endpoints (payTo `0.0.x`), and the Onboard screen fed every payTo to `getAddress` | Filter discovery by `network === eip155:<chainId>` (`6a1e26b`) |
| 30 | Q-Day step 4 printed the vault address instead of the error name | The revert decoder took the first `0x…` blob in the error message (an address) | Shared `revertName()`: viem structured data first, then every standalone 4-byte selector; `agent q --check` now prints `WrongPqKey` |
| 31 | Journal/status timestamps written as guesses ("~11:30") were in the future | Times were estimated instead of read from the clock | Corrected from commit times. **Rule: take times from `date` or `git log`, never estimate** |
| 32 | The real-World CLI run printed nothing while waiting | Output piped through `sed`, which buffers until the process exits, so the verification URL never showed | Read the pending attempt (URL + user code) from the attestor DB. **Lesson: never pipe an interactive/long-waiting command through a buffering filter** |
| 33 | The F8 smoke run's LooseningPending/Cooldown events never reached HCS, yet nothing failed | The facilitator's `/audit` route has an allowlist of event kinds, so new kinds got a 400; the attestor's `audit()` swallowed every error silently | Added the kinds (`ATTESTOR_AUDIT_KINDS`); `audit()` now logs non-2xx and errors with `console.warn`. **Lesson: a "never block" path still needs to be loud** |
| 38 | The live site returned Cloudflare **530** right after a web restart | `lsof -ti :3000 \| xargs kill` also matched **cloudflared**, which holds client sockets to :3000, so it killed the tunnel | Restart only listeners: `lsof -ti tcp:3000 -sTCP:LISTEN`. Restarted the tunnel |
| 39 | The Chrome extension (claude-in-chrome) didn't respond; a headless `--window-size=390` screenshot looked clipped | The extension was unavailable; macOS headless Chrome enforces a minimum window width, so the screenshot showed 390 px of a wider viewport | A small raw-CDP script (`Emulation.setDeviceMetricsOverride` 390×844, mobile) gives true phone renders and `scrollWidth` checks |
| 40 | The live site returned 530 for ~20 s at 17:45 | All tunnel QUIC connections timed out ("no recent network activity"), i.e. the laptop's network dropped UDP | Tunnel switched to `protocol: http2`. The real fix is a VPS backend |
| 41 | Demo agent failed on a tester's vault: `open channel failed (422): simulation_reverted: BadExpiry` | The tester gave the agent a 1 h session; the SDK asks for 1 h channels, so the channel would outlive the session (`req.expiry > s.expiry`) | Pass `sessionExpiry` to `wrapFetchWithLeash` (the demo agent reads it onchain); refusals are now mapped to plain sentences |
| 42 | Remote agents would open channels at `http://localhost:4021` | The 402 `extra.facilitatorUrl` comes from the facilitator's `FACILITATOR_PUBLIC_URL`, which defaulted to localhost | Start the facilitator with `FACILITATOR_PUBLIC_URL=https://facilitator.permissionless.in`, then restart the merchant so it re-registers |
| 43 | "Bad gateway" / 530 on every hostname at 20:16 while all local services ran | All tunnel connections ended with "Error shutting down control stream: context canceled", and cloudflared kept retrying without reconnecting | Restarted cloudflared. Added `scripts/tunnel-watchdog.sh`, which restarts the tunnel after two failed checks of the public URL (~60 s). Running it is part of the live setup |
| 35 | Real World approvals "approved" in the app but the device-token poll stayed `authorization_pending` until expiry (3 attempts) | (1) After the app approval, World's **web page** asks "Are you a returning user?" (create / I have an account), and the request waits on that click. (2) Our registered redirect URI pointed at the apex `permissionless.in`, which serves a different site (the human's Vercel page) | Added the authorization-code + PKCE flow with our own `/api/world/callback`, served via a Cloudflare tunnel; clicked "No, create an account" once. It worked first time. **Lesson: complete the account-linking click on the World web page, and register a callback you actually serve** |
| 36 | `git push` → 403 "Permission to Meet2054/leash denied to Adi-21" | The macOS keychain had GitHub creds for another account | Remote URL `https://Meet2054@github.com/...` + a fine-grained PAT; the human pushed with `! git push` |
| 37 | `cloudflared tunnel login` timed out twice | The authorize tab wasn't completed within cloudflared's window, and the first time the zone wasn't in the Cloudflare account yet | Re-run the login and authorize immediately; zone must be Active (NS switched at GoDaddy) |
| 34 | A DB column added to `CREATE TABLE IF NOT EXISTS` never showed up in the running app | The SQLite file already existed, and Next dev caches the DB handle on `globalThis`, so the schema code never re-ran | `MIGRATIONS` list of `ALTER TABLE … ADD COLUMN` (errors ignored), plus a restart of `pnpm web` after a schema change |
| 23 | Agent session expiry | The CLI vault's session was created with a 24 h TTL (expires 2026-11-07 00:08 IST) | Demo: onboard a fresh vault in the web app with `AGENT_SESSION=agent-session-demo` |

---

## 6. Decisions (short; full list in CLAUDE.md §14 Decision log)
- Own vault + relayer instead of 4337/7702/permit (fewer chain dependencies).
- **ETHFALCON adapter uses ZKNox's pure 4-arg `verify`**, with the pubkey in calldata checked against `pqPubKeyHash`; length-checked + try/catch because it reverts on bad input.
- Factory accepts only `defaultVerifier` at creation (stops squatting a victim's counterfactual address with a permissive verifier).
- Extra EIP-712 types `CloseChannel` and `RevokeSession`; `cooperativeClose` takes a voucherSig too; claim fee only when `msg.sender == relayer`; `MAX_AUTH_AGE = 1h`; `GRACE = 15 min`; BATCH op (no nesting); claims stay valid after revocation.
- x402: implemented `leash-batch` as real `@x402/core` scheme plugins (client/server/facilitator); `@x402/hono` middleware on the merchant; discovery = facilitator `/discovery/resources` + merchant `/.well-known/x402` (IETF draft shape).
- World: IdP **device grant**, action binding server-side (no binding_message in the IdP); `WORLD_MODE=mock` for offline demos, always labelled MOCKED.
- Storage: `node:sqlite` (built in) instead of better-sqlite3 (no native build).
- Hedera primary plan: spec §10 fallback (`exact` scheme via `@x402/hedera` + HCS log). Port the EVM vault only if time allows.
- Data math: lead with **~584× (Falcon both sides, apples to apples)**, ~876× vs ML-DSA-44 second (review 2026-11-06 09:10). Spec drafted at the start of the hackathon; no code pre-written.

---

## 7. Where everything lives
| Path | What |
|---|---|
| `CLAUDE.md` | spec (§0–13) + living project memory (§14) |
| `LEASH_STATUS.md` | latest reviewer report (§12 template) |
| `docs/PROJECT_JOURNAL.md` | **this file** |
| `docs/research/*.md` | verified notes: x402 v2, World IdP, Whitechain/Hedera |
| `docs/DEMO_SCRIPT.md` | 3:30 demo cut + pre-flight + fallbacks |
| `WHITECHAIN_FEEDBACK.md`, `WORLD_DEBRIEF.md` | sponsor feedback docs |
| `contracts/` | Foundry. `src/LeashVault.sol`, `LeashFactory.sol`, `LeashTypes.sol`, `verifiers/EthFalconVerifier.sol`; tests in `test/` (vectors in `test/vectors/`); `script/Deploy.s.sol`; `deployments/1874.json` |
| `packages/sdk` | EIP-712, actions, session signing, x402 scheme client/server, `wrapFetchWithLeash`, `requestLoosening` |
| `packages/relayer` | `Relayer` (simulate-then-send, nonces, replacement, budgets, pause), allowlist, testing helpers (anvil) |
| `packages/facilitator` | channel engine (verify/settle/batcher), Hono app, SQLite store, stats, audit (HCS hook), devnet deploy helpers, `server.ts` |
| `apps/merchant` | 3 paid endpoints + discovery |
| `apps/agent` | `src/agent.ts` (A/B/C/session/stats), `src/owner.ts` (owner CLI), `src/lib/*` |
| `apps/web` | owner PWA (`app/page.tsx`, `components/*`), attestor API (`app/api/*`, `lib/server/*`), WASM Falcon (`lib/client/falcon.ts`, `ethfalcon-wasm.mjs`, `wasm-signer.ts`) |
| `tools/owner-signer` | ZKNox Python Falcon wrapper (`falcon_signer.py`, `gen_vectors.sh`), venv in `.venv/` (gitignored) |
| `tools/falcon-wasm` | `build.sh`, `leash_rng.c` |
| `scripts/` | `deploy-whitechain.sh`, `gen-abi.mjs`, `status.sh` |

### Secrets & key material (names only; all gitignored)
- `.env`: `RELAYER_PK_WHITECHAIN` (also the deployer), `ATTESTOR_PK`, `MERCHANT_{QUOTE,TRANSLATE,SUMMARIZE}_PK`, `RELAYER_FEE_RECIPIENT(_PK)`, `RELAYER_PK_HEDERA`, World/Hedera placeholders.
- `keys/owner.json`: owner Falcon key for the CLI vault. `keys/agent-session.json`: CLI agent session (expires 2026-11-07 00:08 IST). `keys/agent-session-demo.json`: fresh demo session `0x07AB…E3f5`. `keys/vault-1874.json`: CLI vault record (World MOCKED). `keys/falcon-vector-owner.json`: throwaway test-vector key.
- In-browser owner key: IndexedDB (`leash` db) in whichever browser onboarded; back up with "Export key backup".

### Public addresses
| Role | Address |
|---|---|
| Relayer / deployer | `0xD49fF88e1193Bf66D7e1d2b6d81a190C8a07d0Fc` |
| Attestor | `0xCf3Ec7e25b141Da86CB31FcEBBf7d06D51118Ed6` |
| Fee recipient | `0x15214887bECB1bfA641aC5F9F03229Bd299bAFc4` |
| Merchants (quote / translate / summarize) | `0x3425bC52cd7f10F1221eF2708321b4b0924d431D` / `0xE1f69E258c7dEb96E9BfC6534e5fd55211D3f336` / `0x45D40fA17ee8B986553bF11b96130E58Ad71a6Ce` |
| ZKNOX_ethfalcon | `0x4b92C21C389F46d5C6e7339ff3A83e509a91D2bB` |
| EthFalconVerifier | `0x78CdF2C1597487Be1C61dD74C3388C45Dd31B7cB` |
| LeashFactory | `0x754180420d905DbE4A92990C39b22F7373393C66` |
| LeashVault impl | `0x3B0E1F9450203a542f7DC644e58F5CDf13cDB306` |
| CLI vault | `0x3B77877490A4C2A89e55b94e969cae1fA190c392` |
| USDT (prize token) | `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7` |
| Uniswap (testnet): WWBT / SwapRouter02 / WWBT-USDT pool | `0x4200…0006` / `0xe208cC685cD95D56E8ec6DEC9816476567fc6962` / `0x5645101Ca8d2F7BaBC27b10359555767a1BdF999` |

### Hedera testnet (296) — created 2026-11-06 ~01:40 IST by `pnpm hedera:bootstrap`
| Role | Id |
|---|---|
| Operator / facilitator fee payer (human's portal account, ECDSA) — **current since 2026-11-06 ~02:00 IST** | `0.0.11329302` (EVM `0x2c99e3265b270120b2a08f757c23d303213998d4`) |
| HCS audit topic (submit key = current operator) — **current** | `0.0.11329753` https://hashscan.io/testnet/topic/0.0.11329753 (genesis message #1) |
| Retired operator (human rotated credentials; ~1,008 HBAR left, usable as backup) | `0.0.11328871` |
| Retired topic (submit key = retired operator, can't be written by the new one) | `0.0.11329480` |
| Agent (payer) account, 0 HBAR, key in `keys/hedera-demo.json` | `0.0.11329481` |
| Merchant (payTo) account, key in `keys/hedera-demo.json` | `0.0.11329482` |
| USDC (HTS) | `0.0.429274` = `0x…068cda`, 6 dp |

Hedera mandate (facilitator-enforced, off-chain): ≤0.10 USDC per payment, ≤2.00 USDC/day, merchant allowlist, payments above 0.50 USDC need a human approval (refused otherwise). Endpoints: `/hedera/quote` $0.01, `/hedera/translate` $0.02, `/hedera/report` $0.60 (deliberately above the threshold). Run: `pnpm agent h`. Fund the agent: `pnpm --filter @leash/hedera run bootstrap -- --fund 5000000` once the operator has USDC.

### Reproducibility
`contracts/deployments/1874.json` holds the deploy txs, build settings (solc 0.8.25, cancun, optimizer 10000), pinned deps (ZKNox `43ac863`, OZ v5.4.0 `c64a1ed`), deploy commit `41ea8f9`, contracts-source commit `ae2bcd2`, and a bytecode check (all 4 contracts are an exact match with immutables masked). Regenerate with `DEPLOY_COMMIT=<sha> node scripts/record-deploy.mjs`; `scripts/deploy-whitechain.sh` now runs it automatically.

### Key transactions (Whitechain 1874)
- Faucet → relayer `0x756972958c9f60aa8191a81cee37c08b5c43e42df72b0c8a164236932ef342c6`
- Deploy: ZKNOX `0xedfb1a25…1d`, verifier `0xb95c78e1…f14`, factory `0x02b7e6e0…b5`
- Vault created (Falcon onchain, World MOCKED) `0x82290b8eddfaba7b3ed963520edb0c0bbab77fe3eeb1297fb4a34dd27853d298`
- Cap raise 5→8 (Falcon + WorldApproval, World MOCKED) `0x36e2e14380f9fb673061803a10f3cc813f66cb85b5fb6b1b1e1a0ac577b6c1ab`
- USDT swap into the vault `0x9eab9b3e9c09448a1cdf675640c5e02da0091360289024fb8944ce556e9eacb9`
- First claim `0x1ab1d35e4951ed44954ee461eab6fd20568f4f50d530e3869ff126e474a18514` (all 10 claims: facilitator `/claims`)

---

## 8. Runbook
```bash
# services (each in its own terminal)
pnpm facilitator                 # :4021 — restart after sending txs from the relayer key elsewhere
pnpm merchant                    # :4022 — needs the facilitator up first (auto-retries 60 s)
WORLD_MODE=mock pnpm web         # :3000 — or WORLD_MODE=world with WORLD_CLIENT_ID/SECRET
pnpm owner-signer                # :8787 — only for the CLI vault's Python key

# agent & owner
pnpm agent a --calls 300 | b --cap 8 | c | stats | session    # env: AGENT_VAULT, AGENT_SESSION
pnpm owner status | approvals | approve | deny | revoke-session | set-session-cap <usdt> --attest local

# checks
pnpm test        # forge + vitest
pnpm status      # writes data/status-auto.md (then update LEASH_STATUS.md by hand)
bash scripts/deploy-whitechain.sh     # redeploy (only if contracts change; updates deployments/1874.json)

# get testnet USDT into a vault (≈73 USDT per WBT; simulate first, min-out guards price)
set -a; . ./.env; set +a; R=https://rpc.testnet.whitechain.io
cast send 0x4200000000000000000000000000000000000006 "deposit()" --value 0.3ether --private-key $RELAYER_PK_WHITECHAIN --rpc-url $R
cast send 0x4200000000000000000000000000000000000006 "approve(address,uint256)" 0xe208cC685cD95D56E8ec6DEC9816476567fc6962 300000000000000000 --private-key $RELAYER_PK_WHITECHAIN --rpc-url $R
cast send 0xe208cC685cD95D56E8ec6DEC9816476567fc6962 "exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))" "(0x4200000000000000000000000000000000000006,0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7,3000,<VAULT>,300000000000000000,20000000,0)" --private-key $RELAYER_PK_WHITECHAIN --rpc-url $R
# then restart the facilitator (nonce resync)

# regenerate artifacts
node scripts/gen-abi.mjs                       # after contract changes
tools/owner-signer/gen_vectors.sh               # Falcon cross-check vectors
GEN_EIP712_VECTORS=true forge test --mc Eip712VectorsTest   # in contracts/, shared EIP-712 vectors
pnpm build:falcon-wasm                          # needs emcc (brew install emscripten)
```

---

## 9. Gotchas for future agents
- `grep` on this machine is **ugrep**, stricter with some regexes. zsh globs `?` and `*` in unquoted URLs.
- Node in some subshells is v22 (`~/.hermes/node`); the repo default is v26. Both have `node:sqlite`.
- Forge tests use `vm.prank` → compute any external-call arguments first.
- The Whitechain RPC supports **state overrides**: measure gas without deploying (`cast rpc eth_call '{…}' latest '{"0xADDR":{"code":"0x…"}}'`).
- The facilitator holds the relayer's nonce in memory: **one process per relayer key**.
- ETHFALCON key/sig encodings: pubKey = 32 words of compacted NTT(h) (16 × 16-bit per word, coefficient i at bits 16·(i mod 16)); sig = 40-byte salt ‖ compacted s2. ZKNox's C "nist16" variant already outputs NTT(h) and plain 16-bit s2 (big-endian, mod q).
- The ZKNox `foundry.toml` sets `ffi = true`. Never vendor it.

---

## 10. What's next (remaining work, in order)
1. Real World IdP run (once credentials exist) → update WORLD_DEBRIEF "time to first success (real)".
2. Hedera (M7): `exact` endpoint via `@x402/hedera` (facilitator = fee payer, USDC `0.0.429274`), mandate checks in the facilitator, HCS topic mirror (`packages/facilitator/src/hcs.ts` expects `@leash/hedera` `createHcsLog`). README section + HashScan links.
3. Fresh demo vault via web onboarding (WASM key + new session), fund it, rehearse `docs/DEMO_SCRIPT.md`.
4. Hosting for the live demo link (facilitator + merchant + web; needs Node 22+; Python only for the optional local signer).
5. M9: record the video, final `LEASH_STATUS.md`, make the repo public.

---

## 11. What we need from the human (repeat these exact steps when asked "what do we need?")
| # | Step | Why | Status |
|---|---|---|---|
| 1 | WBT from https://faucet.testnet.whitechain.io (GitHub ≥30 days + captcha, 2 WBT/day) → **`0xD49fF88e1193Bf66D7e1d2b6d81a190C8a07d0Fc`** | relayer gas | ✅ done once (2026-11-06); repeat when the Stats tab shows < 0.3 WBT |
| 2 | USDT into the vault | real payments | ✅ done via swap (21.93 USDT). For a new demo vault: swap again (runbook) or withdraw from the old vault |
| 3 | **World IdP sandbox app**: sign in with Google at https://sandbox.auth.world.org/portal → create app → register an **HTTPS** redirect URI (required even for device flow; no localhost) → client auth `client_secret_basic` → copy the secret (shown once) → put `WORLD_CLIENT_ID`, `WORLD_CLIENT_SECRET` (and optionally `WORLD_ID_ISSUER=https://sandbox.auth.world.org`) in `.env` | real World ID (prize) | ⏳ open |
| 4 | **A test World identity**: ask the World mentors how hackathon "mocked proofs" work (which issuer, which steps), or get the iOS sandbox World App via TestFlight | complete the real World check | ⏳ open |
| 5 | **Hedera**: ✅ operator / facilitator fee payer **`0.0.11329302`** (ECDSA; key in `.env`, verified against the account; rotated from the retired `0.0.11328871`); ✅ HCS topic `0.0.11329753`, agent `0.0.11329481`, merchant `0.0.11329482` (`pnpm hedera:bootstrap`); ✅ payments live in HBAR. Optional: USDC to the agent `0.0.11329481` (faucet Network = **Hedera Testnet**, not Arc), then set `HEDERA_PAY_ASSET=usdc` | Hedera prize (M7) | ✅ done (HBAR); USDC optional |
| 6 | **Hosting** for the live demo link (Railway / Fly / a VPS). Tell us which, or give access | ETHGlobal + sponsors want a live link | ⏳ open |
| 7 | **Make the GitHub repo public** (and push) when ready | submission | ⏳ open |
| 8 | **Record the demo video** with us (`docs/DEMO_SCRIPT.md`) | submission | ⏳ open |
