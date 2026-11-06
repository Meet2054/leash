# World ID Agent Pass — integration debrief (Leash)

**What we built:**
- An AI agent can **ask** its owner to loosen its onchain spending mandate (for example, raise its cap). It can never approve that itself.
- Approval requires a fresh World ID check, done by our backend through the **World IdP device authorization grant**.
- Only after the ID token is validated does our attestor sign an EIP-712 `WorldApproval` bound to the exact change hash. The owner's post-quantum key then signs the change, and the vault applies it onchain.
- **The denied, cancelled and expired paths sign nothing and change nothing.**

Code: [`apps/web/lib/server/world.ts`](apps/web/lib/server/world.ts), [`attestor.ts`](apps/web/lib/server/attestor.ts), and the routes under [`apps/web/app/api/`](apps/web/app/api/).

## Honest status (updated 2026-11-06 17:05 IST)
- **Real World IdP (sandbox) works end to end, and it is live onchain:**
  - **Vault creation after a real World check:** World redirected to our callback with the code; our backend exchanged it, validated the ID token (`acr` = orb, `amr` = `["pop"]`, `auth_time` 16:58:19 IST) and bound the subject (`0x52a6…2249`). The attestor signed and the owner's Falcon key signed. Vault [`0x45A14B41…5F06`](https://explorer.testnet.whitechain.io/address/0x45A14B41D527d2Ea138dcf86C3f60cD2d27c5F06) was created, [tx `0x04dd758a…8d23`](https://explorer.testnet.whitechain.io/tx/0x04dd758ae43fc97dc1354df60267ca6254ab7999571eef1252237412a0738d23).
  - **Scenario B with real World on that vault:**
    1. The agent's direct `applyChange` reverts (`WrongPqKey`).
    2. A Cornell-style 500 USDT ask is blocked by our attestor policy before any World check (max 2× per 24 h).
    3. An 8 USDT ask the owner **denies** → nothing signed, nothing onchain.
    4. An 8 USDT ask the owner **approves** with a fresh real World check (pinned to the vault's `sub`, `auth_time` 17:03:20 IST) → cap 5 → 8 onchain, [tx `0xf714cb0b…28f9`](https://explorer.testnet.whitechain.io/tx/0xf714cb0b65f62a3a2b9ee690fcbd00158fa9a68cf526bf5bb9a5866445ba28f9).
- **Real denied and expired paths:** two device-grant attempts returned `access_denied` (13:44, 13:56), and three expired without completion (15:22, 15:45, 16:49). None of them signed anything.
- **Which flow:** the authorization-code + PKCE (browser) flow, with the callback served by our backend. The device grant is still implemented, but our approvals never completed with it (see friction #10).
- **What is still MOCKED:** the older CLI vault `0x3B77…c392` and its approvals (bootstrap, Q-Day drill, F8 smoke test) used the local mock issuer. They are labelled MOCKED wherever they appear.

## First run against the real World IdP (sandbox), 2026-11-06
- **13:28 IST:** credentials from the sandbox portal accepted (`device_authorization` → user code). Our backend started a vault-creation attempt bound to the InitConfig (`577a3417…`).
- **13:40:** the sandbox World ID app on the phone showed *Verify with World ID → Human → Unique human → **Failed to share***. Most likely the sandbox identity was still being issued (World's guide warns it takes ~1 h, and the Human card can appear before it's ready).
- **13:44:52 IST:** the World IdP returned **`access_denied` ("Authorization was denied.")** to our device-token poll. Our backend marked the attempt **DENIED**, signed **nothing**, and created **no vault**. The denial is on HCS topic 0.0.11329753, message **#23** (`ApprovalDenied`). **This is the required denied path, from the real IdP.**
- **13:54–13:56 IST, attempt 2 (`30c5bd8e…`):** the human reported the identity "ready", but the sandbox app again showed *Failed to share*, and the IdP again returned `access_denied`. No identity reached our backend (no `sub`, `auth_time` or `amr`), so nothing was signed. **Friction:** the app gives no reason for "Failed to share" and no sign of whether issuance is complete; the backend only sees a generic `access_denied`. A distinct error code (e.g. `credential_not_ready`) would save developers an hour of guessing.
- Next: approve once the sandbox identity is issued (or as World's mentors advise), then record the time to first real success below.

## Time to first success
- About **55 minutes** from opening the docs (23:30 IST) to the first approved, World-gated mandate change landing onchain (≈00:25 IST). That was with the mocked issuer.
- Reading and understanding the IdP took about 10 minutes, because the docs are concise and the discovery document is complete.
- Time to first success against the **real** IdP: about **3 h 30 min**, from working credentials (13:28 IST) to the first real World-gated vault creation (16:58 IST). Only ~1 h of that was code (the browser flow + callback). The rest was waiting for the sandbox identity to issue and finding out why approvals never came back (friction #10). With what we know now, the job is ~1 h: register the callback on a domain you actually serve, use the code flow, and click through "Are you a returning user?" on first use.

## Friction
1. **Naming.** The prize says "World ID Agent Pass" and links `auth.world.org`, but the docs never use "Agent Pass"; they say "World IdP". We also had to rule out AgentKit (`@worldcoin/agentkit`, the x402 product) and IDKit. One sentence ("Agent Pass = World IdP at auth.world.org") would remove that confusion.
2. **No action binding.** There is no CIBA, no `binding_message` (the docs explicitly say it isn't shown or signed) and no RAR `authorization_details`. The ID token proves who authenticated and when, not *what they approved*. So we bind the action ourselves, server-side: the attempt is created for one change hash and used once, and the attestor key vouches for it. That attestor is the main remaining trust point in our design.
3. **Device-flow ID tokens carry no `nonce`.** That's fine, but freshness then relies entirely on `auth_time` plus our own attempt record.
4. **Portal requirements for a backend-only flow.**
   - A device-only client still needs a registered **HTTPS** redirect URI, and `http://localhost` isn't allowed, so local development needs a tunnel or a placeholder.
   - Sign-in is Google only.
5. **Test identities.**
   - The iOS sandbox app comes via TestFlight. The link on the ETHGlobal page was reported dead by other teams, and issuance can take about an hour.
   - The prize page says "we are mocking proofs now", but we found no docs on *how* (which issuer, which steps).
   - An undocumented `auth.worldcoin.dev` labels itself "fake identities and mock proofs", but we couldn't confirm it's meant for builders.
6. **Selfie Check assurance classes are documented but not live.** Discovery lists only the orb classes and `/api/v1/features` returns `selfieCheck:false`.
7. **The web Simulator can't be used.** Its CSP blocks the IdP bridge (confirmed), so you can't test from it.
8. **No Agent Pass workshop, and conflicting test-identity guidance.** The ETHGlobal page links only an IDKit workshop. It says proofs are mocked so the sandbox app isn't needed, while World's testing guide says a sandbox World ID needs the TestFlight app. Neither says which issuer or steps the mock uses.
9. **Good: agent-native tooling exists.** The developer MCP server lets a coding agent register and manage the app (CIMD OAuth, Google consent), and the step-up guide's "Human checkpoints" section describes exactly our pattern.

10. **Device-grant approvals never completed for our client, and the cause was invisible.**
    - With our client, the app showed approval, but the token poll stayed `authorization_pending` until the device code expired (three attempts). The OAuth Playground's default client worked.
    - What we found:
      - After the app approval, the **web page** still asks *"Are you a returning user? This proof of human is not linked to any account"* (create account / I have an account). Nothing in the app or the docs says the request waits on that browser step.
      - The redirect URI we had registered was on a domain that serves a different site.
    - We switched to the authorization-code flow with a callback we serve (via a Cloudflare tunnel), clicked "No, create an account" once, and it worked first time. The second approval asked "Yes, I have an account".
    - **Ask:** document the account-linking step for the device flow, and make the token poll return a distinct error while it is waiting on it.

## Missing capability / docs
- **An action-bound approval:** let the relying party pass an `action_hash` (or a `binding_message` that is shown to the user **and signed into the ID token**).
- A documented **mock-proof environment** for hackathons: issuer URL, test users, what `amr`/`acr` you get.
- A **sample backend** for the device grant (Node, about 50 lines), including the exact polling and termination rules. We wrote ours from the guide text.

## Single most valuable improvement
**Sign the approved action into the ID token.** With a claim like `"approved_action": "<hash the RP sent>"`, a relying party, or even a smart contract via an attestor-free verifier, could prove that *this human approved exactly this action*, not just that they logged in recently. For agent use cases (agents asking humans for permission) that's the whole point, and it would remove the trusted-attestor hop from designs like ours.

## What was great
- Standard OIDC means `jose` plus `fetch` was enough, with no SDK needed.
- The discovery document is complete, the error codes for device polling are clear, and the docs **recommend signed local fixtures** for testing, which is exactly what made our mocked offline mode cheap to build and honest to label.
