# VPS hosting: landing page and app subdomain

The project supports this setup without Next.js or a frontend server build:

| Address | Served by | Content |
| --- | --- | --- |
| `https://rillvane.trade/` | Caddy, from `dist/` | Landing page |
| `https://app.rillvane.trade/` | Caddy → Node on `127.0.0.1:8787` | App, API, wallet sessions and WebSocket stream |

Production landing buttons open the app subdomain. App logo/story links return to the landing domain. The app uses relative `/api/` URLs, so cookies, wallet authentication and streaming stay on the app origin. Old `/app/` URLs redirect to the app root. Local development still serves the landing at `/` and app at `/app/`.

These are project configuration changes only; DNS and VPS services have not been changed.

## 1. Prepare the checkout and environment

The examples assume Ubuntu/Debian, Node.js 24 installed at `/usr/bin/node`, Caddy installed as a system service, and a checkout at `/srv/rillvane`. Adjust the paths in the service, environment and Caddyfile together if needed.

From the checkout:

```sh
npm ci
npm run check
npm run test:backend
npm run test:ui
test -f .env || cp ops/vps.env.example .env
chmod 600 .env
```

Edit `.env` with your existing chain configuration and these settings:

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=8787
PUBLIC_ORIGIN=https://app.rillvane.trade
SITE_MODE=app
DATABASE_PATH=/var/lib/rillvane/rillvane.sqlite
REGISTRY_PATH=/srv/rillvane/ops/registry.json
KEYS_DIR=/srv/rillvane/ops/keys
```

Set `OPS_TOKEN` to a random value of at least 32 characters and set `SOLANA_RPC_URLS` to your configured network's HTTPS RPC endpoint. Keep `EXECUTION_MODE=protocol` and `WORKER_ENABLED=true`. The example uses devnet; mainnet remains disabled.

Preserve the existing registry and authority files (`deployer.json`, `oracle.json`, `faucet.json`, `keeper.json`) under `ops/keys/`. Transfer them privately when moving hosts; they are not part of a fresh pull. Do not regenerate registry or authority keys for an existing deployment. Preserve the existing SQLite database when migrating, following the [backup and restore runbook](../ops/RUNBOOK.md#backup-and-restore).

The static frontend is already in `dist/`. Run `npm run build:wallet` only when updating its wallet dependencies/bundle.

## 2. Run the app as a service

Create a dedicated account if it does not already exist, then create its data directory:

```sh
id rillvane >/dev/null 2>&1 || sudo useradd --system --home-dir /var/lib/rillvane --shell /usr/sbin/nologin rillvane
sudo install -d -o rillvane -g rillvane -m 700 /var/lib/rillvane
sudo chown root:rillvane .env
sudo chmod 640 .env
sudo chown -R root:rillvane ops/keys
sudo chmod 750 ops/keys
sudo chmod 640 ops/keys/*.json
```

Ensure the service account can traverse the checkout and read the source and registry. Caddy must also be able to read `dist/`. The supplied service permits writes only to `/var/lib/rillvane` and its private temporary directory; change its `ReadWritePaths` if you choose another database directory.

Check the configured database and RPC as the service account, then install the service:

```sh
sudo -u rillvane /usr/bin/node --env-file=.env backend/preflight.mjs
sudo install -m 644 ops/rillvane.service /etc/systemd/system/rillvane.service
sudo systemctl daemon-reload
sudo systemctl enable --now rillvane
sudo systemctl status rillvane
curl --fail http://127.0.0.1:8787/api/health
```

Preflight creates/migrates the configured database and verifies RPC connectivity. It does not provision authority keys. Inspect service logs with `sudo journalctl -u rillvane -n 100 --no-pager`.

## 3. Point both domains at the VPS

Create DNS A records for `rillvane.trade` and `app.rillvane.trade` pointing to the VPS IPv4 address. Add AAAA records only if the VPS also serves IPv6 correctly. Allow inbound ports 80 and 443. Port 8787 stays on loopback.

The supplied `ops/Caddyfile` serves only `dist/` on the landing domain and proxies the app domain, including WebSockets, to Node. It also redirects legacy landing-domain `/app/` links. Preserve the rest of your Caddy configuration if it already hosts other sites; merge these two site blocks instead of replacing unrelated configuration.

For a VPS dedicated to this project:

```sh
sudo install -m 644 ops/Caddyfile /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy provisions HTTPS certificates once DNS points to the server and the ports are reachable. The proxy blocks public operator endpoints and readiness/liveness probes; query those through loopback.

## 4. Verify and update

```sh
curl --fail https://rillvane.trade/
curl --fail https://app.rillvane.trade/
curl --fail https://app.rillvane.trade/api/health
curl -I https://app.rillvane.trade/app/
```

The landing URL should show the journey, the app root should show the workspace, and the last request should redirect to `/`. In a browser, check landing/app links, wallet sign-in, session restoration and the live market connection. Sign in again on the new app domain; cookies from a previous domain cannot transfer.

After pulling future updates, preserve `.env`, authority keys and database, run `npm ci` and the checks above, then `sudo systemctl restart rillvane`. Validate and reload Caddy if its configuration changed. Keep one Node instance for this SQLite database. Use the runbook for backups before schema changes.

## Docker alternative

Use Docker instead of the systemd Node service if preferred. `ops/compose.yaml` sets app mode, persists the database in `rillvane-data`, and binds port 8787 to loopback. Provision `ops/keys/` before starting; it is mounted read-only and must be readable by container UID 1000. Keep the existing registry matching those keys. Set `PUBLIC_ORIGIN`, `OPS_TOKEN` and `SOLANA_RPC_URLS` in `.env` as above, then run:

```sh
docker compose --env-file .env -f ops/compose.yaml config --quiet
docker compose --env-file .env -f ops/compose.yaml up --build -d
docker compose --env-file .env -f ops/compose.yaml ps
```

Compose uses container paths for the database, registry and keys; it does not use the host paths from the systemd example. Use the same host Caddy configuration. Do not run both app services on port 8787. After a pull, repeat the Compose build/start command; retain the persistent volume. Caddy and the containers need validation on the actual VPS.
