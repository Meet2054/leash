# World ID Agent Pass (World IdP) notes (verified 2026-11-05)

"Agent Pass" on the ETHGlobal prize page = the **World IdP** at auth.world.org (docs say "World IdP"). Not IDKit, not AgentKit.
Docs: https://auth.world.org/docs (guides: oidc, step-up, id-token, testing, app-registration), https://auth.world.org/llms.txt

## Environments
| | Issuer | JWKS |
|---|---|---|
| sandbox (dev) | `https://sandbox.auth.world.org` | `/.well-known/jwks.json` |
| production | `https://auth.world.org` | `/.well-known/jwks.json` |
Endpoints (same paths on both): `/api/v1/authorize`, `/api/v1/token`, `/api/v1/device_authorization`, `/api/v1/userinfo`, `/api/v1/revoke`. RS256 ID tokens, pairwise `sub`.

## Flows
- Authorization code + **S256 PKCE (mandatory)**, query response with `iss` param.
- **Device Authorization Grant (RFC 8628)** for confidential clients — best fit for "backend asks owner to approve one action".
- NOT supported: CIBA/backchannel, `binding_message`, RAR `authorization_details`, request objects, client_credentials.
- The ID token proves *who/how/when* only; binding to the action is **our** job: store the pending change (changeHash, vault, owner sub, device_code, deadline) server-side and consume it once.

## Our attestor flow (device grant)
1. `POST /api/v1/device_authorization` (client auth: client_secret_basic) with `scope=openid` and `claims={"id_token":{"acr":{"essential":true,"values":["https://world.org/oidc/acr/orb-face"]}, "sub":{"value":"<bound sub>"}}}` (sub pin only after first link; a different account → `access_denied`).
2. Show `user_code` + `verification_uri_complete` (QR) to the owner; keep `device_code` server-side only.
3. Poll `POST /api/v1/token` (`grant_type=urn:ietf:params:oauth:grant-type:device_code`) every `interval` s:
   - 400 `authorization_pending` → keep polling; `slow_down` → +5 s to interval
   - `access_denied` / `expired_token` / `invalid_grant` / any other error / 503 / 429 → **stop, mark DENIED/EXPIRED, never sign**
   - device code lives 20 min, single redemption
4. Validate ID token with `jose`: `jwtVerify(createRemoteJWKSet(jwks), { issuer, audience: clientId, algorithms: ["RS256"] })`, then `auth_time >= attempt.startedAt`, `amr` includes `"pop"` (passkey-only `["pop","user","mfa"]`… note: require `"pop"`; `-face` acr cannot be satisfied by passkey), `acr` in accepted set, `sub` matches bound subject. Record `jti` (single use).
5. Only then sign `WorldApproval` (EIP-712, attestor key) with `authTime = auth_time`.
- Device-flow ID tokens have **no nonce**; browser code flow has `nonce` + `max_age=0`.
- `acr` values: `https://world.org/oidc/acr/{orb,orb-face,selfie,selfie-face}`. Selfie classes **not live** (`/api/v1/features` → selfieCheck:false); only orb classes in discovery.

## HUMAN setup
- Portal (Google sign-in): sandbox https://sandbox.auth.world.org/portal. Create app → register exact HTTPS redirect URI (required even for device-only; no http localhost) → client auth `client_secret_basic` → copy secret (`worldidp_client_secret_…`, shown once) → Settings → Authenticate default accepted accounts.
- Env: `WORLD_ID_ISSUER`, `WORLD_CLIENT_ID`, `WORLD_CLIENT_SECRET`.
- Test identity: iOS sandbox World App via TestFlight (link on ETHGlobal page may be dead) — or the hackathon's "mocked proofs" (ask World mentors which issuer; an undocumented `https://auth.worldcoin.dev` labels itself "fake identities and mock proofs").
- OAuth playground (sandbox): https://oauth-playground.toolsforhumanity.dev/
- Web Simulator CSP blocks the IdP bridge (confirmed) — don't use it.

## Local testing
Docs recommend signed local fixtures: generate an RS256 key, serve a local JWKS, mint ID tokens for validation and failure-path tests. We do this in vitest and in `WORLD_MODE=mock` for offline demos (clearly labelled MOCKED).

## Update 2026-11-06 ~09:40 IST (sandbox docs re-read)
- **Human checkpoints** (step-up guide) is World's named pattern for our case: pause the agent workflow, run step-up (device grant for headless), save the exact action + version + expiry bound to the attempt, re-check at execution, use the approval once in the same DB transaction, and leave denial/cancel/expiry blocked. Our attestor matches this. Since 09:40 it also **pins the vault's linked `sub`** in the device request (`claims.sub`) when the vault was onboarded through the real IdP.
- **Developer MCP (agent-native app registration):** `https://sandbox.auth.world.org/mcp/developer` (Streamable HTTP + OAuth, CIMD; no DCR). For Claude Code: `claude mcp add --transport http --scope user world-id-developer-sandbox https://sandbox.auth.world.org/mcp/developer`, then `/mcp` → Google sign-in + consent with scope `developer-portal:manage`. The agent can then register/manage the sandbox app through tools. `list_idp_guides` needs no auth.
- **Test identities:** the ETHGlobal prize page says "We are mocking proofs now, so you don't need sandbox app anymore" ("fake identities, DO NOT rely in them for production") but gives no issuer or steps. World's testing guide still says a sandbox World ID needs the TestFlight app (Add proof of human → Manual verify, ~1 h). Conflicting; ask the World mentors. "Sandbox auth does not establish Orb verification", so don't request essential `orb` acr in sandbox (our `WORLD_REQUEST_ACR` is empty by default).
- No Agent Pass workshop is listed on ETHGlobal. The only World workshop video linked is for IDKit (not this flow).
