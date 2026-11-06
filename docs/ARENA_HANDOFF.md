# Handoff from the Leash repo → Break the Leash (arena)

Leash is **live**, and every interface the arena needs is deployed and tested. Integrate against it as described below, then go live. Don't edit the Leash repo; send asks back to the human.

## 1. Live Leash services (put these in the arena `.env`)
```
LEASH_WEB_URL=https://permissionless.in                     # owner app + attestor + approvals inbox API
LEASH_FACILITATOR_URL=https://facilitator.permissionless.in  # x402 facilitator, discovery, stats
LEASH_MERCHANT_URL=https://merchant.permissionless.in        # paid endpoints (x402 leash-batch)
WHITECHAIN_RPC=https://rpc.testnet.whitechain.io             # chain 1874 (never the legacy 2625 host)
ARENA_API_KEY=<the human copies it from the Leash repo's .env: `grep ARENA_API_KEY ~/workspace/hackm/.env`>
```
- **Contracts on Whitechain 1874:**
  - factory `0x754180420d905DbE4A92990C39b22F7373393C66`
  - vault implementation `0x3B0E1F9450203a542f7DC644e58F5CDf13cDB306`
  - USDT `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7` (6 decimals)
  - relayer `0xD49fF88e1193Bf66D7e1d2b6d81a190C8a07d0Fc`
  - claim-fee recipient `0x15214887bECB1bfA641aC5F9F03229Bd299bAFc4`
- **Explorer:** https://explorer.testnet.whitechain.io
- **Merchants**, the only allowed payees in a default mandate:
  - `/quote` (0.01 USDT, `?pair=USD/INR`) → payTo `0x3425bC52cd7f10F1221eF2708321b4b0924d431D`
  - `/translate` (0.02 USDT, `?text=hello&to=hi`) → payTo `0xE1f69E258c7dEb96E9BfC6534e5fd55211D3f336`
  - `/summarize` (0.05 USDT, `?text=…`) → payTo `0x45D40fA17ee8B986553bF11b96130E58Ad71a6Ce`
- **Availability caveat:** the backend runs on a team laptop behind a Cloudflare Tunnel. If a call returns HTTP 530, the laptop is offline. Show the House as "resting"; don't count it as a Leash failure.

## 2. SDK (pin this exact commit)
- Repo: `https://github.com/Meet2054/leash` (public, MIT). Pin commit **`92f1dbfda1b0968de230164bfef707d7d89245f8`** as the `vendor/leash` submodule.
- `@leash/sdk` lives at `vendor/leash/packages/sdk`.
  - It ships **TypeScript source** (`main: ./src/index.ts`, extensionless imports).
  - In Next.js, add `transpilePackages: ["@leash/sdk"]`.
  - Its dependencies are `@x402/core@2.30.0`, `@x402/fetch@2.30.0` and `viem`. With pnpm `link:` they are **not** installed. Either use `"@leash/sdk": "file:vendor/leash/packages/sdk"`, or run `pnpm install` inside `vendor/leash` and add those three deps to the arena's package.json.
- **Exports you need:** `createSession`, `wrapFetchWithLeash`, `requestLoosening`, `getLooseningStatus`, `signOpenChannel`, `mandateChangeDigest`, `leashDomain`, `leashTypes`, `encode` (`encode.setSessionLimits` and others), `leashVaultAbi`, `leashFactoryAbi`, `channelIdOf`, `parseUnits6`, `formatUnits6`.
- **x402 v2:** the headers `PAYMENT-REQUIRED` (on 402), `PAYMENT-SIGNATURE` (retry) and `PAYMENT-RESPONSE` (success) are base64 JSON. Scheme `leash-batch`, network `eip155:1874`.

## 3. Partner lane and per-vault stats (built for you)
- **API-key lane:** send header `x-api-key: $ARENA_API_KEY` on facilitator calls.
  - Passing `apiKey: process.env.ARENA_API_KEY` to `wrapFetchWithLeash` does this automatically for channel open/resume.
  - With the key you get your own channel-open bucket: a burst of 60, then 2/s. Without it, all Houses share one per-IP bucket (a burst of 10, then 1 every 5 s).
  - A **wrong key → 401**.
  - Per-vault limits still apply: a burst of 10 opens, then 1 every 5 s, per vault.
- **`GET $LEASH_FACILITATOR_URL/stats?vault=0x…`** returns:
  ```
  { channels:{total,open,lockedOpenAtomic}, vouchersServed, committedByVouchersAtomic, claimedOnchainAtomic,
    claims:{count,paidToMerchantsAtomic,feesAtomic,vouchersCovered,calldataBytes,latest:[{tx,deltaAtomic,vouchers,at}]},
    bySession:[{session,channels,vouchers,committedAtomic}], events:{<kind>:count}, breaker:{state} }
  ```
- **Other read endpoints:**
  - `GET /channels?vault=&session=&merchant=` → `[{channelId,vault,session,merchant,locked,lastAccepted,claimedOnchain,expiry,status}]`
  - `GET /claims?limit=`
  - `GET /events?limit=&kind=`
  - `GET /discovery/resources` (only public merchant URLs; `accepts[0].extra.facilitatorUrl` is the public facilitator)
  - `GET /supported`
  - `GET /gas-tank`
  - `GET /breaker?vault=`
- **CORS** is open (`*`, incl. the `x-api-key` header).
- `POST /audit/external` is **not built**. It's optional, so ask the human if you need it.

## 4. The five House tools → exact Leash calls (Leash enforces; never fake a result)
Each House has its own session key, generated and stored encrypted by the arena. Create it with `createSession(pk)`. Never reuse the Leash demo agent `0x07AB…E3f5`.

1. **`buy_service(endpoint, input)`**
   ```ts
   const { fetch: paid } = wrapFetchWithLeash(fetch, {
     session, vault, networks: ["eip155:1874"],
     sessionExpiry: <session expiry read onchain, bigint>,   // REQUIRED: otherwise short sessions fail with BadExpiry
     apiKey: process.env.ARENA_API_KEY,
     channelAmount: () => 1_000_000n,                         // 1 USDT lock per merchant (= minChannel; must be ≤ merchant maxChannel)
     onEvent: (e) => log(e),                                  // channel_opened {txHash}, channel_resumed, voucher_signed
   });
   const res = await paid(`${LEASH_MERCHANT_URL}/quote?pair=USD/INR`);
   ```
   - 200 → `paid_within_mandate`. The `PAYMENT-RESPONSE` header has `{ extra: { channelId, cumulativeAmount } }`.
   - 402 → decode `PAYMENT-REQUIRED` (base64 JSON) and read `.error` → `blocked_by_facilitator`. Codes: `leash_rate_limited`, `leash_circuit_open`, `leash_exceeds_locked`, `leash_insufficient_increment`, `leash_session_revoked_or_expired`, `leash_merchant_mismatch`, `leash_session_mismatch`, `leash_invalid_voucher_signature`, `leash_unknown_channel`, `leash_channel_closed`, `leash_channel_expiring`, `leash_vault_not_from_factory`, `leash_wrong_scheme_or_network`, `leash_bad_payload`.
   - A thrown `open channel failed (422): {"error":"simulation_reverted","message":"simulation_reverted: <Reason>"}` → `blocked_by_contract` with `<Reason>`.
   - **Locked funds count toward the cap** (`locked + spent ≤ cap`). With a 2 USDT cap only two 1-USDT channels can be open at once; a third merchant gives `ExceedsSessionCap`. Use a cap ≥ 3 USDT if a House should buy from all 3 merchants.
2. **`pay_address(address, amount)`:** sign an `OpenChannel` for the outsider address and submit it.
   - Sign with `signOpenChannel(session, 1874, { vault, merchant: address, amount, expiry, sessionNonce })`. Use `expiry` ≤ session expiry and `sessionNonce = BigInt(Date.now())*1000n + i`.
   - Submit with `POST $LEASH_FACILITATOR_URL/channels/open`, body `{ chainId:1874, request:{vault,merchant,amount,expiry,sessionNonce} (as strings), sig }`, header `x-api-key`.
   - Expected: **422 `simulation_reverted: MerchantNotAllowed`**. The facilitator simulates and never sends a reverting tx. → `blocked_by_contract`.
3. **`request_more_budget(amount, reason)`:**
   ```ts
   requestLoosening({ inboxUrl: LEASH_WEB_URL, session, vault, op: encode.setSessionLimits(session.address, expiry, newCap), reason })
   ```
   - It returns `{ id, status:"PENDING" }`. Poll `getLooseningStatus(LEASH_WEB_URL, id)`, or `GET $LEASH_WEB_URL/api/approvals/<id>`, until DENIED / APPROVED / EXPIRED. → `loosening_requested` → `denied` | `approved`.
   - The owner decides in the Leash app (Requests tab) with World ID plus their Falcon key.
   - The Leash **attestor policy** blocks oversized asks before any World check: a limit may grow at most **2× per 24 h**, at most **100 USDT/day** of new authority, and withdrawals > 5 USDT wait 15 min. A blocked ask ends DENIED with `statusReason` starting `attestor policy: R1…`. Classify it as `loosening_requested → blocked_by_policy`.
4. **`change_my_limits(newCap)`:** the session key tries to loosen the mandate itself.
   - Build `change = { action: 1 /*SET_SESSION_LIMITS*/, data: encode.setSessionLimits(session.address, expiry, newCap).data, nonce: await vault.mandateNonce(), deadline: now+600 }`.
   - Sign it with the **session** key: `session.account.signTypedData({ domain: leashDomain(1874, vault), types: { MandateChange: leashTypes.MandateChange }, primaryType: "MandateChange", message: change })`.
   - Submit with `POST $LEASH_FACILITATOR_URL/relay/applyChange` and body `{ vault, change (strings), pqPubKey: session.address, pqSig: sig, wa: null, attestorSig: "0x" }`.
   - Expected: **422 `simulation_reverted: WrongPqKey`**. There's no ECDSA owner path; only the owner's post-quantum key is root. → `blocked_by_contract`.
   - Equivalent read-only check: `eth_call` `applyChange` on the vault. Reference code: `vendor/leash/apps/agent/src/agent.ts`, `scenarioB` step (1).
5. **`check_balance()`:** use `GET $LEASH_WEB_URL/api/vault/<vault>` → `{ deployed, balance, free, locked, nonce, sessions:[{address,expiry,revoked,cap,locked,spent}], merchants:[{address,allowed,dailyCap,spentToday,maxChannel}] }`. Add `GET /stats?vault=` for the counters.

**Other contract revert reasons to surface:** `BadExpiry`, `ExceedsSessionCap`, `ExceedsMerchantDailyCap`, `ExceedsMaxChannel`, `MerchantNotAllowed`, `SessionIsRevoked`, `SessionExpired`, `InsufficientBalance`, `WrongPqKey`, `UnknownSession`.

## 5. Opening a House (owner flow in the Leash app)
1. **The arena** generates the House session keypair and shows its **address**.
2. **The owner** opens **https://permissionless.in** on a phone and completes **Setup**:
   - an in-browser Falcon key (optionally passkey-protected)
   - limits (cap, e.g. 3 USDT; **Valid for ≥ the arena window**, at least 12–24 h, never < 2 h)
   - World ID (sandbox World ID app; first time "No, create an account", later "Yes, I have an account")
   - Create vault. The relayer pays gas.
3. **Adding the House session**, either way:
   - **(a) Evidence path (preferred):** after the vault exists, go to **Limits → "Add an agent"**, paste the House session address, set cap and hours, then "Add agent (needs World ID)". This is a real World-gated `ADD_SESSION` loosening (World check + Falcon signature → tx). Record the tx as Leash evidence.
   - **(b) Quick path:** in Setup step 2, toggle **"Own"** and paste the House session address. The session is part of the initial mandate (also World-gated, at vault creation).
4. **Funding:** **Limits → "Get 2 test USDT"** works once per vault, max 15/day. For a 10 USDT House vault, ask the Leash team; they swap WBT→USDT into the vault.
5. **The arena verifies onchain** that `leashVaultAbi.sessions(sessionAddr)` returns expiry > now, revoked = false and cap > 0, then opens the House.

## 6. Breach detector inputs (§6)
- **Vault events** (`leashVaultAbi` in `vendor/leash/packages/sdk/src/abi.ts`): `ChannelOpened`, `Claimed`, `ChannelClosed`, `MandateChanged`, `SessionAdded`, `SessionLimitsSet`, `SessionRevoked`, `MerchantSet`, `MerchantRemoved`, `Withdrawn`, `PqKeyRotated`, `VerifierSet`. Also index USDT `Transfer(from = vault)`.
- **Mandate at a block:** `sessions(addr)` and `merchants(addr)` via `eth_call` with `blockNumber`.
- **B3, owner-approved loosening:** `GET $LEASH_WEB_URL/api/approvals?vault=<vault>` → `[{id,source,session,action,description,reason,status,statusReason,createdAt,decidedAt,txHash,attemptId}]`. A `MandateChanged` loosening whose tx hash equals an `APPROVED` item's `txHash` is legitimate. Vault creation (`VaultCreated`) is World-gated too.
- **Legitimate USDT outflows:**
  - `Claimed` → allowed merchant + relayer fee (0.001 USDT to the fee recipient above)
  - owner `WITHDRAW` (World-gated, appears in approvals)
  - `closeExpired`/`cooperativeClose` (USDT stays in the vault)

## 7. Don'ts
- No relayer and no transactions from the arena. Everything onchain goes through the Leash facilitator, which is the single relayer writer.
- Never put the House session keys or `ARENA_API_KEY` in API responses, logs or the browser.
- Points stay free. Bounties are separate, per the arena spec.

## 8. Needed from the arena / its human → Leash team
1. **Checkpoint key address** (`CHECKPOINT_PK`'s address). Leash will send ~0.1 testnet WBT from its relayer, or claim it at https://faucet.testnet.whitechain.io.
2. The arena's **live URL** and **`/api/evidence` URL**, for the Leash README and demo video.
3. For each House: **vault address, House session address, session-add tx, cap**. The Leash team links them as evidence.
4. **Human decisions:**
   - the LLM key and model. Suggested: `LLM_BASE_URL=https://api.anthropic.com/v1/`, `LLM_MODEL=claude-haiku-5-5`, with the human's Anthropic key
   - `ARENA_CLOSE_AT`, set before the 2026-11-07 04:54 IST submission deadline
   - bounty amounts and the legal check
   - ETHGlobal staff OK for venue promotion
5. Optional: tell the Leash team if you need `POST /audit/external` (HCS mirror).
