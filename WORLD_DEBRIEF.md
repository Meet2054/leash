# World ID Agent Pass — integration debrief (Leash)

**What we built:**
- An AI agent can **ask** its owner to loosen its onchain spending mandate (for example, raise its cap). It can never approve that itself.
- Approval requires a fresh World ID check, done by our backend through the **World IdP device authorization grant**.
- Only after the ID token is validated does our attestor sign an EIP-712 `WorldApproval` bound to the exact change hash. The owner's post-quantum key then signs the change, and the vault applies it onchain.
- **The denied, cancelled and expired paths sign nothing and change nothing.**

Code: [`apps/web/lib/server/world.ts`](apps/web/lib/server/world.ts), [`attestor.ts`](apps/web/lib/server/attestor.ts), and the routes under [`apps/web/app/api/`](apps/web/app/api/).

## Honest status
- The **device-grant integration against `auth.world.org` is implemented**: device_authorization, token polling with `authorization_pending` / `slow_down` / `access_denied` / `expired_token`, and JWKS validation with `jose`.
- **It has not yet run against the real IdP.** We don't have portal credentials yet, and we don't have a sandbox World ID (the TestFlight link from the prize page may be dead).
- Every World check so far ran with `WORLD_MODE=mock`: a local RS256 issuer that mints an ID token, which then goes through **the same validation code path** (signature, `iss`, `aud`, `exp`, `auth_time` > attempt start, `amr ∋ pop`, `jti` single use, subject equals the vault's bound World ID). It is labelled **MOCKED** in the UI, the logs and the README.
- Live onchain result with the mocked issuer: a denied request → no transaction. An approved request → the agent's cap went 5 → 8 USDT onchain on Whitechain (tx `0x36e2e143…c1ab`).

## Time to first success
- About **55 minutes** from opening the docs (23:30 IST) to the first approved, World-gated mandate change landing onchain (≈00:25 IST). That was with the mocked issuer.
- Reading and understanding the IdP took about 10 minutes, because the docs are concise and the discovery document is complete.
- Time to first success against the **real** IdP: not reached yet (blocked on credentials and a test identity).

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

## Missing capability / docs
- **An action-bound approval:** let the relying party pass an `action_hash` (or a `binding_message` that is shown to the user **and signed into the ID token**).
- A documented **mock-proof environment** for hackathons: issuer URL, test users, what `amr`/`acr` you get.
- A **sample backend** for the device grant (Node, about 50 lines), including the exact polling and termination rules. We wrote ours from the guide text.

## Single most valuable improvement
**Sign the approved action into the ID token.** With a claim like `"approved_action": "<hash the RP sent>"`, a relying party, or even a smart contract via an attestor-free verifier, could prove that *this human approved exactly this action*, not just that they logged in recently. For agent use cases (agents asking humans for permission) that's the whole point, and it would remove the trusted-attestor hop from designs like ours.

## What was great
- Standard OIDC means `jose` plus `fetch` was enough, with no SDK needed.
- The discovery document is complete, the error codes for device polling are clear, and the docs **recommend signed local fixtures** for testing, which is exactly what made our mocked offline mode cheap to build and honest to label.
