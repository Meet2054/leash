#!/usr/bin/env bash
# Leash single-host deploy (Ubuntu 22.04/24.04, run as root on a fresh VPS).
#
#   DOMAIN=leash.example.com REPO_URL=https://github.com/<org>/leash.git bash deploy/bootstrap.sh
#
# Before running:
#   1. DNS: an A (and/or AAAA) record DOMAIN → this server's IP.
#   2. Persistent volume mounted at /var/lib/leash (or the script uses the root disk).
#   3. Copy secrets to the server (never through git):
#        scp .env root@HOST:/var/lib/leash/env/.env
#        scp -r keys root@HOST:/var/lib/leash/keys
# Re-running is safe: it pulls, rebuilds and reloads.
set -euo pipefail

: "${DOMAIN:?set DOMAIN, e.g. DOMAIN=leash.example.com}"
REPO_URL="${REPO_URL:-}"
ROOT=/srv/leash
DATA=/var/lib/leash
NODE_MAJOR="${NODE_MAJOR:-24}"

echo "==> packages (git, curl, ufw, caddy, node ${NODE_MAJOR}, pnpm, pm2)"
apt-get update -y
apt-get install -y git curl ca-certificates gnupg ufw debian-keyring debian-archive-keyring apt-transport-https
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi
corepack enable
corepack prepare pnpm@10.15.1 --activate
command -v pm2 >/dev/null || npm install -g pm2@5

echo "==> firewall: only SSH + HTTP(S); app ports stay on 127.0.0.1"
ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw --force enable >/dev/null

echo "==> persistent data at ${DATA}"
mkdir -p "$DATA"/{env,keys,data,logs}
chmod 700 "$DATA/env" "$DATA/keys"
[ -f "$DATA/env/.env" ] || { echo "!! missing $DATA/env/.env — scp your .env there first"; exit 1; }
[ -f "$DATA/keys/hedera-demo.json" ] || echo "   (no keys/hedera-demo.json: Hedera endpoints stay off until you copy keys/)"

echo "==> code at ${ROOT}"
if [ -d "$ROOT/.git" ]; then
  git -C "$ROOT" pull --ff-only
elif [ -n "$REPO_URL" ]; then
  git clone --depth 1 "$REPO_URL" "$ROOT"   # contracts/lib submodules are not needed at runtime
else
  echo "!! set REPO_URL (or rsync the repo to $ROOT)"; exit 1
fi
# secrets + state live on the volume; the repo only holds symlinks
ln -sfn "$DATA/env/.env" "$ROOT/.env"
ln -sfn "$DATA/keys" "$ROOT/keys"
ln -sfn "$DATA/data" "$ROOT/data"

echo "==> install + build"
cd "$ROOT"
pnpm install --frozen-lockfile
(cd apps/web && set -a && . ../../.env && set +a && APP_URL="https://${DOMAIN}" pnpm exec next build)

echo "==> Caddy (HTTPS for ${DOMAIN})"
sed "s/__DOMAIN__/${DOMAIN}/g" deploy/Caddyfile.template > /etc/caddy/Caddyfile
mkdir -p /var/log/caddy
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl enable caddy >/dev/null 2>&1 || true
systemctl reload caddy || systemctl restart caddy

echo "==> pm2 (facilitator → merchant → web)"
export DOMAIN LEASH_ROOT="$ROOT" LEASH_DATA="$DATA"
pm2 startOrReload deploy/ecosystem.config.cjs --update-env
pm2 save
pm2 startup systemd -u root --hp /root >/dev/null || true

echo "==> health"
sleep 8
bash deploy/check.sh "$DOMAIN" || true
echo "done. Owner app: https://${DOMAIN}  ·  facilitator: https://${DOMAIN}/facilitator/supported  ·  merchant: https://${DOMAIN}/merchant/.well-known/x402"
