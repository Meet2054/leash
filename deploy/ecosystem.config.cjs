/**
 * pm2 process file for the single-host deploy.
 *   DOMAIN=leash.example.com pm2 start deploy/ecosystem.config.cjs && pm2 save
 * Secrets come from /srv/leash/.env (a symlink to the persistent volume), never from this file.
 */
const DOMAIN = process.env.DOMAIN;
if (!DOMAIN) throw new Error("set DOMAIN, e.g. DOMAIN=leash.example.com pm2 start deploy/ecosystem.config.cjs");
const ROOT = process.env.LEASH_ROOT || "/srv/leash";
const DATA = process.env.LEASH_DATA || "/var/lib/leash";

const common = {
  cwd: ROOT,
  interpreter: "none",
  script: "pnpm",
  autorestart: true,
  max_restarts: 20,
  restart_delay: 3000,
  time: true,
};

module.exports = {
  apps: [
    {
      ...common,
      name: "leash-facilitator",
      args: "--filter @leash/facilitator start",
      out_file: `${DATA}/logs/facilitator.out.log`,
      error_file: `${DATA}/logs/facilitator.err.log`,
      env: {
        CHAIN: "whitechain",
        BIND_HOST: "127.0.0.1",
        FACILITATOR_PORT: "4021",
        FACILITATOR_PUBLIC_URL: `https://${DOMAIN}/facilitator`,
        FACILITATOR_DB: `${DATA}/data/facilitator-1874.sqlite`,
      },
    },
    {
      ...common,
      name: "leash-merchant",
      args: "--filter @leash/merchant start",
      out_file: `${DATA}/logs/merchant.out.log`,
      error_file: `${DATA}/logs/merchant.err.log`,
      env: {
        BIND_HOST: "127.0.0.1",
        MERCHANT_PORT: "4022",
        MERCHANT_PUBLIC_URL: `https://${DOMAIN}/merchant`,
        FACILITATOR_URL: "http://127.0.0.1:4021",
      },
    },
    {
      ...common,
      name: "leash-web",
      args: "--filter @leash/web start",
      out_file: `${DATA}/logs/web.out.log`,
      error_file: `${DATA}/logs/web.err.log`,
      env: {
        BIND_HOST: "127.0.0.1",
        WEB_PORT: "3000",
        APP_URL: `https://${DOMAIN}`,
        FACILITATOR_URL: "http://127.0.0.1:4021",
        WEB_DB: `${DATA}/data/web-1874.sqlite`,
        LEASH_ROOT: ROOT,
        NODE_ENV: "production",
      },
    },
  ],
};
