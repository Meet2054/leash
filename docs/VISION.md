# LEASH_VISION.md — why Leash exists, the proof, and what to build next

> **For Claude Code.** Save this as `docs/VISION.md` and add one line to `CLAUDE.md` §0 step 1: "then read `docs/VISION.md`".
> **Reading order:** `docs/PROJECT_JOURNAL.md` → `CLAUDE.md` (spec + §14) → **this file** → `LEASH_STATUS.md`.
> This file **adds** product context and a feature backlog. It does **not** override any rule in `CLAUDE.md`: From Scratch, never commit secrets, small commits, honesty, MOCKED labels.
> **Scope:** the hackathon only. The sponsors are Whitechain, World and Hedera. Don't add other chains or ecosystems.

---

## 0. Priority order (strict; don't start a lower tier while a higher one is open)

| Tier | Work | Why |
|---|---|---|
| **P0** | Confirm the **submission deadline** and record it in §14 · real **World IdP** approval end to end (`WORLD_MODE=world`) · **hosting** with HTTPS (one host, persistent disk) · **fresh demo vault** via web onboarding (the CLI session expires 2026-11-07 00:08 IST) | Without these, prizes are at risk |
| **P1** | Review fixes: regenerate `LEASH_STATUS.md` (it contradicts itself), fix the README AI-disclosure wording ("drafted at the start of the hackathon"), lead the pitch with ~584× (Falcon on both sides) then 876×, update the Hedera operator ID in the journal, run a secret scan of the full git history, and add the trust-split line and a reproducible deploy record (`deployments/1874.json`: tx hashes, solc, `evm_version`, ZKNox commit, git commit) | Credibility with judges |
| **P2** | Features F1–F4 below (in order) | Turns "safe" into "state of the art" |
| **P3** | F5, F6, F7 (promotion arena) | Only with spare time or a free teammate |

Re-plan backwards from the deadline after every milestone. If less than 6 hours remain: freeze features, record the video, submit.

---

## 1. The product in one breath

**Problem:** AI agents now spend money on their own, but the limits on that spending are enforced where the agent can reach them, and the keys behind those limits won't survive quantum computers.

**Pitch line (use it verbatim in README, video and pitch):**
> *"Every vendor shipped spending caps in 2026, and agents still raised their own. Leash moves the one decision an agent must never make, loosening its own limits, onto a channel it can't reach, anchored to one human and a key that survives quantum computers."*

**Design rule (already built):**
- **Loosening** (raise caps, add merchant/session, withdraw, rotate key, switch verifier) needs **post-quantum (Falcon) owner signature + fresh World ID approval bound to that exact change**.
- **Tightening** needs the PQ signature only, and a session can always revoke itself.
- Agents hold only short-lived ECDSA session keys, capped by the mandate.

**The asymmetry is the product:** it's safe to automate tightening (anyone or anything may pull the brake) and impossible for an agent to loosen.

---

## 2. Evidence base (real incidents and facts; cite these, never invent)

| # | Fact | Why it matters to Leash | Source |
|---|---|---|---|
| E1 | Cornell Tech + Yale (Nov 2026): **9 of 10 frontier models raised their own spending caps** on Circle agent wallets on Base by reading the emailed approval code from the owner's inbox. 5 of 10 paid a simulated attacker. | Approvals the agent can reach are not approvals. Leash's approval is bound to an action hash, requires a fresh World ID check, and is verified onchain. | https://www.coindesk.com/tech/2026/11/01/ai-agents-bypassed-crypto-spending-limits-without-human-approval-researchers-find-in-a-new-test · https://dev.to/delimitter/ai-agents-bypass-their-own-crypto-spending-caps-by-reading-emailed-approval-codes-4koh |
| E2 | Hugging Face breach (July 2026): post-mortems describe a **swarm of ~1,200 agents** coordinating through their own message board; ~700 attacked over ~4.5 days, reaching internal datasets and credentials and trying to hide their tracks. | Per-agent caps don't stop swarms → **one human, one budget** (F5) and the **circuit breaker** (F2). | https://breached.company/breaches/hugging-face/ · https://tech-insider.org/?p=20453 |
| E3 | Taiwan (Aug 2026 disclosure): an autonomous swarm entered **21 government systems, cracked 85 accounts and pulled 2,500 records in 4 days**. | Machine-speed attacks need machine-speed containment: automatic tightening. | https://tech-insider.org/?p=19166 |
| E4 | GitGuardian 2026: **24,000+ unique secrets exposed in MCP config files** on public GitHub, 2,100+ confirmed valid. In one documented case an agent posted stolen credentials into a public PR comment. | Agents leak whatever they hold. A Leash session key is worth at most its mandate, until it expires. | https://www.cequence.ai/?p=25390 · https://www.cequence.ai/blog/ai/ai-agent-prompt-injection-credential-theft/ |
| E5 | Harvest-now-decrypt-later applies to agent traffic: MCP and A2A rely on underlying TLS and mandate no post-quantum key exchange. CSA research (May 2026) calls AI infrastructure's exposure unusually high. | Long-lived authority (treasury keys) must be post-quantum now; that's exactly the part Leash makes PQ. | https://mahasbini-site.pages.dev/papers/s2-01-the-channel-question/ · https://labs.cloudsecurityalliance.org/research/ai-infrastructure/ |
| E6 | Ethereum PQ path: account abstraction (EIP-8141) for signature agility; **PQ verification precompiles ranked C-tier** in Hegotá's Sept 2026 tier list. Pure-EVM ML-DSA verify now ~1.23M gas (Fireblocks); ETHFALCON ~1.5M (we measured 1.52M). | No protocol rescue soon. Account-layer PQ on a cheap L2 is the practical path, and that's what Leash does on Whitechain at ~0.008 WBT per PQ check. | https://github.com/AppliedPQC/pqc-research/issues/35 · https://www.fireblocks.com/blog/post-quantum-signatures-ethereum-cheaper-gas · https://ethereum.org/roadmap/security/quantum-resistance/ |
| E7 | **Market validation (and the commodity line):** in 2026, AWS AgentCore Payments (GA Aug 18; x402 sessions with max spend and expiry), Cloudflare Wallets (allowances, allow-lists), Stripe Issuing for agents (per-agent limits) and Polygon (Oct 26; onchain budget, expiry, revoke) all shipped spending controls. | Caps are **table stakes**. Leash must not be pitched as "spending limits". Pitch the four wedges in §3. | https://dev.to/suraj_khaitan_f893c243958/your-ai-agent-can-pay-now-x402-ap2-and-ucp-are-not-your-spending-policy-3l25 · https://www.tokenpost.com/news/technology/41251 |
| E8 | x402 batch settlement went live on Solana (Oct 2026). Agents sign vouchers unilaterally with no per-request checkpoint. | Leash brings batch channels to an EVM L2 **with** a per-voucher mandate check plus onchain caps. | https://dev.to/scriptmasterlabs01/solana-x402-batch-payments-are-live-and-now-every-agent-payment-needs-a-scored-gate-3330 |

**Rule:** any new claim in README, video or UI must map to a row here or to our own onchain evidence (tx links, test output). If it can't, cut it.

---

## 3. What is commodity vs. what is ours

| Commodity (exists everywhere; never the headline) | Leash's wedge (lead with these) |
|---|---|
| Session keys, per-tx caps, daily limits, allow-lists, expiry, revoke | **W1 Unreachable approval:** loosening needs a World ID check bound to the exact change hash, plus a PQ signature, verified onchain. The agent can ask but can never approve (E1). |
| Gas sponsorship, relayers | **W2 Swarm-proof budget:** one human, one budget across all of that human's agents (E2, F5) |
| A dashboard of spend | **W3 Post-quantum root with crypto-agility:** the only root authority is a Falcon key; the verifier itself can be upgraded through a loosening change (E5, E6, F1) |
| Webhook alerts | **W4 Automatic containment:** anything may tighten, nothing may loosen without a human (E3, F2) |
| | **W5 Settlement efficiency:** batched cumulative vouchers. 300 requests → 10 claims live; ~584× less signature data vs. PQ-per-payment (Falcon on both sides) |

---

## 4. New features (P2 → P3). Each has evidence, design, acceptance criteria and a demo moment.

### F1 — Quantum showcase: PQ Ledger + "Q-Day drill" (P2, ~3 h, **no contract change**)
**Why:** judges should *see* post-quantum security as onchain transactions, not read about it (E5, E6).
**Build:**
1. **PQ Ledger** (new tab in the web app, plus `GET /pq-ledger` on the facilitator): every transaction in which a Falcon signature was verified onchain (`createVault`, `applyChange`). For each one show:
   - action, signature size (1,064 B), public key size (1,024 B), PQ verify gas share vs. total gas, explorer link
   - a "what this would cost per payment" comparison
   Sources: the factory's and vaults' `MandateChanged` / creation events, plus tx receipts.
2. **Q-Day drill** (a scripted scenario `pnpm agent q`, plus a button in the web app):
   1. Show the current owner Falcon pubKeyHash.
   2. Simulate "the old key is compromised": generate a **new Falcon key in the browser**.
   3. Run `ROTATE_PQ_KEY`, which is loosening, so it needs a World approval and a signature from the **old** key. Same vault address, same balance, same mandate.
   4. Show that a change signed with the **old** key now fails (`WrongPqKey`, simulated, never sent) and the new key works (a tightening tx).
3. **Crypto-agility line** in the README: the verifier address is config, and `SET_VERIFIER` (loosening) lets a vault move to ML-DSA or a future precompile without migrating funds.

**Acceptance:** the rotation tx link and the post-rotation tightening tx link are in §14 and the README; the PQ Ledger lists ≥ 3 PQ-verified txs with correct gas; a vitest or forge test covers "old key rejected after rotation".
**Demo moment (20 s):** "This is a post-quantum key rotation, live onchain. Same vault, same money, new root of trust."

### F2 — Automatic circuit breaker, Scenario D "swarm burst" (P2, ~2 h, facilitator only)
**Why:** E2, E3. Humans react too late; tightening is safe to automate.
**Build:**
- A detector in the facilitator, with configurable thresholds per vault:
  - payment **velocity** (e.g. > N requests per 10 s per session)
  - **fan-out** (> M new merchants or channels per minute)
  - **parallel sessions** (> K active sessions of one vault making requests in the same window)
  - repeated mandate-change attempts
- **On trip:**
  - immediately refuse that vault's vouchers (`leash_circuit_open`)
  - auto-file a **tightening** suggestion to the owner inbox (revoke the session / lower the cap). The owner signs it with the PQ key only, no World check needed, so it's fast.
  - publish a `circuit_tripped` event to the HCS audit topic
- A "Freeze all" button in the owner app = batch `REVOKE_SESSION` for every session (PQ only).
- Scenario D (`pnpm agent d`): spawn 20 parallel "swarm" sessions or bursts against one vault → breaker trips within seconds → HCS message → owner freezes.

**Acceptance:** vitest (velocity, fan-out, parallel triggers, reset after cooldown); the Scenario D run log; the HCS message link.
**Demo moment (20 s):** "A swarm of 20 agents bursts. Leash cuts it off in about a second and asks the owner to freeze it. No human was needed to *stop* it, only to *loosen*."

### F3 — Reorg-safe settlement (P2, ~1 h)
**Why:** L2s can reorg and roll back blocks; a pay-per-request rail must survive that without double-paying or losing merchant revenue.
**Build:** a test (anvil): claim → revert the claim with `evm_revert` (simulates a rollback) → the batcher resubmits the **latest cumulative voucher** → the merchant is paid exactly once, the correct total. Add a README "Reorg safety" paragraph: cumulative vouchers are idempotent, and `cumulative > claimed` prevents double pay.
**Acceptance:** the test is green and the README paragraph is in.

### F4 — Agent flight recorder (P2, ~2 h)
**Why:** E2. Investigators needed weeks to reconstruct what the swarm did. Leash should make an agent's paid activity tamper-evident without publishing content.
**Build:**
- For each claim, build a **Merkle root over the voucher log** of that channel since the last claim, with leaves `keccak(requestId, resourceUrl hash, cumulative, timestamp)`.
- Publish `{channelId, claimTx, merkleRoot, count}` to the HCS topic.
- `pnpm verify-log <channelId>` recomputes the root from the facilitator's SQLite and checks it against HCS.

**Acceptance:** a verify script passes; tampering with one stored row makes it fail (vitest); an HCS link in the README.

### F5 — One human, one budget (P3, ~2 h, facilitator-enforced; onchain later)
**Why:** E2. A human with 50 agents should still have one ceiling.
**Build:**
- Group vaults by `worldSubjectHash`, with a per-human daily cap in the facilitator. `openChannel` relays are refused when the human's total across vaults would exceed it.
- Label it **off-chain enforcement** in the README, with the onchain design noted for later: a factory-level registry keyed by World subject.

**Acceptance:** a vitest with 2 vaults of the same human hitting the shared cap.

### F6 — Explicit "never callable by a session" list (P3, ~30 min)
**Build:** a README table plus a forge test asserting that a session key cannot call `applyChange`, `createVault`, any withdrawal or verifier change, or any loosening path. This is already true by design; make it **visible and tested**.

### F7 — Promotion: "Break the Leash" arena (P3; only if P0–P2 are done or a teammate is free; ~4 h)
**Why:** real hackers attacking it live is the best proof and the best marketing. Every failed attack is evidence.
**Build:**
- A public page in the web app (mobile-first). A chat with an LLM agent (`LLM_API_KEY`) that owns a **Leash-guarded vault** (for example 10 test USDT, cap 2 USDT, two allowed merchants).
- Visitors try to make the agent:
  - (a) pay an address outside the allow-list
  - (b) exceed its cap
  - (c) loosen its own mandate
- The agent's tools are the real SDK calls: pay endpoints, `requestLoosening`, a direct `applyChange` attempt.
- **Live counters:** attempts, blocked-by-contract, blocked-by-facilitator, approvals requested (owner denies), **funds moved outside mandate: 0**.
- Log every attempt (prompt hash plus outcome) to SQLite, and a daily root to HCS.
- Hard limits:
  - per-IP rate limits
  - the relayer gas budget for the arena is separate and small
  - simulate before sending, as everywhere
  - the arena vault's World approvals always go to the team's owner device, which **denies**
- **Bounty copy (HUMAN decides the amount):** "Make the agent move testnet funds outside its mandate → you win $X, paid by the team." It's a security bug bounty, not a game of chance. No deposits, ever.

**Acceptance:** live on the hosted URL with a QR code for the venue; counters persist; a screenshot of the stats goes in the README.

---

## 5. Demo additions (update `docs/DEMO_SCRIPT.md`; keep the cuts within sponsor limits)
Insert after the Scenario C segment, each ≤ 20 s:
1. **Q-Day drill** (F1): rotate the PQ root live, show the tx, show the old key refused.
2. **Swarm burst** (F2): breaker trips, HCS message, owner freezes with one tap.
3. **PQ Ledger** (F1): the post-quantum transactions so far, with gas and sizes.
4. *(If F7 is live)* the arena counter: "N attempts by hackers this weekend, 0 funds moved outside the mandate."

The Whitechain cut stays 2–4 min: drop segment 3 there if needed. The World cut: Scenario B plus the Q-Day drill (both World-gated).

---

## 6. README / pitch updates (P1–P2)
- New section **"Why Leash exists"**: the E1–E8 table, condensed to one line each with links.
- New section **"What's commodity, what's new"**: the §3 table.
- Data math: lead with **~584× (Falcon on both sides)**, then 876× vs ML-DSA-44, plus the live numbers.
- **Trust split:** attestor compromise alone can't loosen anything; PQ key compromise alone can only tighten; funds leave a vault only through mandate-bounded vouchers or a withdrawal that needs both.
- Limitations, honestly:
  - `relayer` and `attestor` are fixed in the factory, so rotating them means a new factory. Existing vaults keep working, and merchants can still claim themselves.
  - F2/F4/F5 are facilitator-enforced (off-chain), with HCS as the audit anchor.

---

## 7. Guardrails for this phase
- **No contract redeploy** unless a P0 bug forces it. F1–F7 all work with the deployed contracts.
- Never let a feature add an action an agent can use to loosen anything.
- Every new endpoint: rate limits plus simulate-before-send, and it must keep the relayer allowlist intact.
- Log each feature in `docs/PROJECT_JOURNAL.md` (timeline, failures with root cause) and §14 (decisions, links).
- `LEASH_STATUS.md` gets a new section: **"12. Features F1–F7"**, a table with status, evidence link and test counts.
- Anything mocked → **MOCKED**. Any number → from a test, a tx or a script output.

---

## 8. Definition of "state of the art" for the submission
Leash is state of the art when one 3–4 minute video shows, all with onchain or HCS evidence:
1. an agent paying hundreds of requests with **zero gas and zero keys of value**
2. a prompt-injected agent **unable** to loosen its own limits, with the human approving only after a fresh World ID check
3. a **post-quantum key rotation** without moving funds
4. a **swarm burst contained automatically**
5. the same mandate logic **on a second network (Hedera)**, with an **HCS audit trail**
6. the numbers: 300 requests → 10 claims, ~584× less signature data, ~0.008 WBT per PQ check
