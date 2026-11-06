# Single-host deploy (facilitator + merchant + owner app)

One VPS runs all three services under **pm2**. **Caddy** terminates HTTPS for `DOMAIN`:

| Public URL | Service | Local port |
|---|---|---|
| `https://DOMAIN/` | owner app + World attestor API (Next.js) | 3000 |
| `https://DOMAIN/facilitator/*` | x402 facilitator + relayer (Hono) | 4021 |
| `https://DOMAIN/merchant/*` | demo merchant (x402-paid endpoints) | 4022 |

Persistent state lives on a volume at **`/var/lib/leash`**: `env/.env` (secrets), `keys/` (Hedera demo keys, agent session), `data/` (SQLite: facilitator channels and claims, attestor approvals), `logs/`. The repo at `/srv/leash` only contains symlinks to it.

## Steps (any Ubuntu 22.04/24.04 VPS: Hetzner, DigitalOcean, Lightsail, Fly Machines with a volume…)
1. Create the server (1 vCPU / 2 GB is enough) and mount a volume at `/var/lib/leash`.
2. Point DNS: an `A` record from `DOMAIN` to the server IP.
3. Copy the secrets over (never through git):
   ```bash
   ssh root@HOST 'mkdir -p /var/lib/leash/env /var/lib/leash/keys'
   scp .env root@HOST:/var/lib/leash/env/.env
   scp keys/hedera-demo.json keys/agent-session-demo.json root@HOST:/var/lib/leash/keys/
   ```
4. Bootstrap (installs Node 24, pnpm, pm2, Caddy, ufw; builds; starts everything):
   ```bash
   ssh root@HOST 'git clone --depth 1 <REPO_URL> /srv/leash && DOMAIN=<DOMAIN> bash /srv/leash/deploy/bootstrap.sh'
   ```
5. Check: `bash deploy/check.sh <DOMAIN>` (all ✓). The live demo link is `https://<DOMAIN>`.

## Notes
- **Set `ADMIN_TOKEN` in the server `.env`** (a long random string). It protects `/facilitator/admin/*` (force-batch, circuit-breaker reset) and `/facilitator/audit`. Without it those endpoints are open.
- **The relayer key is single-writer.** Never run a second facilitator with the same `RELAYER_PK_WHITECHAIN` (laptop + server at once) or nonces collide. Stop the laptop facilitator before going live.
- `WORLD_MODE=world` plus `WORLD_CLIENT_ID/SECRET` in the server `.env` enables the real World IdP. Register `https://<DOMAIN>/` as the redirect URI in the World portal.
- The in-browser Falcon key (WASM) needs HTTPS, which Caddy provides. The Python owner-signer is not deployed.
- Updating: `ssh root@HOST 'cd /srv/leash && git pull && DOMAIN=<DOMAIN> bash deploy/bootstrap.sh'`.
- Logs: `pm2 logs`, `/var/lib/leash/logs/*.log`, `/var/log/caddy/leash.log`.
- Tested locally: the same Caddy routing in front of the three services passes `deploy/check.sh` (8/8), and x402 `PAYMENT-REQUIRED` headers pass through.
