# Live demo on Cloudflare (leash.permissionless.in)

**How the live link is served:**
- Cloudflare terminates TLS at its edge and forwards requests through an outbound-only **Cloudflare Tunnel** to the backend host. The host opens no ports.
- The backend host runs:
  - the owner app + attestor (`apps/web`, Next.js)
  - the facilitator + relayer (`packages/facilitator`)
  - the merchant (`apps/merchant`)
- The frontend and the attestor API are served together on purpose. World requires the ID-token validation and the client secret to stay in a backend. The attestor and facilitator keep state in SQLite, so the server side has to be a persistent Node process, not an edge function.

## Run it (any host with Node 22+, e.g. a VPS or this laptop)
```bash
# 1. backend (same as local; secrets in .env, never committed)
pnpm install
pnpm facilitator &          # :4021
pnpm merchant &             # :4022
pnpm --filter @leash/web build
APP_URL=https://leash.permissionless.in \
WORLD_FLOW=browser WORLD_REDIRECT_URI=https://leash.permissionless.in/api/world/callback \
BIND_HOST=127.0.0.1 pnpm --filter @leash/web start   # :3000, only reachable through the tunnel

# 2. edge
cloudflared tunnel --config ~/.cloudflared/leash.yml run leash    # see tunnel.example.yml
```
- Register `https://leash.permissionless.in/api/world/callback` as the redirect URI of the World IdP app (sandbox portal).
- `deploy/bootstrap.sh` does the same on a fresh VPS with Caddy + pm2, if you'd rather not use a tunnel.

## Moving the backend to a server
1. Copy `.env` and `keys/` to the server out of band. They hold secrets, so they never go into git.
2. Run the commands above on the server.
3. Run the same tunnel there (copy `~/.cloudflared/<TUNNEL_ID>.json`), or create a new one.
4. Stop the laptop facilitator. There must be **one relayer writer per key**, or nonces clash.
