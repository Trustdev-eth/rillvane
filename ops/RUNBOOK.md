# Rillvane origin — deployment and recovery

This release packages the RLVN/USDC protocol origin: integer engine, wallet-signed intents, oracle/liquidation workers, and SQLite projections. Mainnet is disabled. Deploy on a Node host; the static Site does not run this process.

## Supported topology

One Node.js 24 process on one host, local SQLite on a persistent block volume, integrated job worker, HTTPS reverse proxy. The API serves the same `dist/` frontend, preserving same-origin cookies. Never put this SQLite volume on NFS or run replicas against copied databases. `NODE_ENV=production` enables strict runtime configuration checks. `EXECUTION_MODE` must be `protocol`.

The published static Site serves files only. It does **not** host this Node process. Deploy this package on a Node/container host with a persistent volume and use its HTTPS origin to reach wallet features. Do not configure a cross-origin API URL or add wildcard CORS.

## Configuration

1. Copy `backend/.env.example` to a host-only environment file. Keep it outside version control and user downloads.
2. Set `PUBLIC_ORIGIN` to the exact HTTPS origin, `NODE_ENV=production`, and `DATABASE_PATH` to an absolute mounted-volume path. Set `HOST=0.0.0.0` only inside the container or protected network.
3. Configure `SOLANA_RPC_URLS` with one or two dedicated HTTPS RPC endpoints, or `http://127.0.0.1:8899` for a local validator. Commas separate endpoints. Query-string API credentials are accepted but never logged. Remote endpoints are genesis-checked against `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`.
4. Generate `OPS_TOKEN` with at least 32 random characters, keep it server-side, and limit access to operators. Changing it revokes the old operator bearer token. It grants read access to metrics and audit records, not wallet control.
5. Keep `EXECUTION_MODE=protocol`, `WORKER_ENABLED=true`. Run `node scripts/bootstrap.mjs` once to write `ops/registry.json`.

From the checkout, run checks and preflight:

```sh
npm run check
npm run test:ui
npm run test:backend
node --env-file=.env backend/preflight.mjs
```

Preflight creates/migrates the database, checks database integrity, verifies the RPC cluster and reads a finalized slot. It fails when the provider is offline or the network is wrong. No wallet secret is required.

## Container deployment

`ops/compose.yaml` binds the HTTP port only to the host loopback address, mounts `/data`, drops Linux capabilities and starts a non-root read-only container. Set the required interpolation variables in your shell or a host-only Compose env file, then run from the repository root:

```sh
docker compose -f ops/compose.yaml up --build -d
docker compose -f ops/compose.yaml ps
```

Place Caddy or an equivalent TLS proxy on the same host. Adapt the domain in `ops/Caddyfile`. The proxy blocks `/api/ops/*`, `/readyz` and `/livez` from public access. Internal monitoring can query the loopback API port. Preserve the `Origin` header. Never expose the container's raw HTTP port publicly. The app deliberately ignores forwarded client-IP headers; all proxied visitors share the proxy's application rate bucket. Add per-visitor rate controls at the edge, then size app limits for the actual deployment. Do not blindly trust `X-Forwarded-For`.

The image uses the official Node 24 base tag, which receives updates. Before a controlled release, build/scan and record the resulting image digest; pin the approved digest in the deployment environment. Docker and Caddy configurations are supplied but were not executed in the development environment. A real host, DNS/TLS and provider credentials have not been configured here.

## Probes, telemetry and incident checks

| Endpoint | Check | Access |
| --- | --- | --- |
| `/livez` | HTTP process alive | Internal proxy/network |
| `/readyz` | Database query + verified RPC finalized-slot read; 10-second cache | Internal proxy/network |
| `/api/health` | Public mode declaration, mainnet disabled | Public |
| `/api/ops/metrics` | Prometheus text counters and worker queue gauges | Operator bearer token |
| `/api/ops/audit?before=<id>` | Newest 100 audit records, cursor pagination | Operator bearer token |

HTTP responses include a generated request ID. JSON request logs contain method, status, duration and request ID; they omit cookies, authorization headers, request bodies, wallet addresses, signatures and RPC URLs. Audit records deliberately retain wallet/action associations and must be treated as private operator data. They are application records, **not** tamper-proof or immutable evidence. Export to a restricted external sink if independent retention is required.

Suggested alerts: readiness failure for 2 minutes, exhausted jobs > 0, worker heartbeat older than 60 seconds while enabled, sustained RPC errors, growing pending queue, HTTP error spike, disk > 80%, backup age > 24 hours. These are operator recommendations, not configured external alerts. Rate limits persist in SQLite: 120 API requests/IP/minute and 24 auth requests/IP/minute, plus 8 challenges/wallet/minute. The tracking queue caps active work at 20/wallet and 1,000 globally.

## Transaction lifecycle and notifications

An authenticated user submits a signature to `POST /api/chain/transactions`. A repeat signature for that wallet returns the same record. The worker leases jobs for two minutes, retries with bounded exponential backoff, and recovers expired leases after restart. It only uses an allowlist of read-only RPC methods.

| State | Meaning |
| --- | --- |
| `unknown` | Not observed at usable commitment, provider unavailable, or finality no longer observable |
| `confirmed` | Confirmed transaction fetched and this wallet verified as a signer |
| `confirmed_error` | Confirmed execution error, awaiting finality |
| `finalized` | Finalized transaction fetched, signer verified, no on-chain error |
| `failed` | Finalized transaction fetched, signer verified, on-chain execution error |
| `rejected` | Retrieved transaction does not include this wallet as a signer |

After 12 unsuccessful/nonterminal checks the job is `exhausted`; the transaction retains its observed state. A timeout does not prove failure or expiry. Operators should inspect the explorer/provider and account signer association before investigating; there is no automatic rebroadcast.

State-change notifications are inserted atomically with the transaction update. `GET /api/notifications?after=<id>` retrieves a user's next 50 messages; `POST /api/notifications/read` acknowledges one owned ID. Delivery and acknowledgements can repeat across transport failures, so this is not an exactly-once UI delivery guarantee. The wallet UI polls every 10 seconds while visible and signed in. No email, Slack, web push or third-party notification channel is configured.

## Backup and restore

Use the SQLite online-backup API, never copy the live main file alone while WAL writes are active. Backups contain wallet associations, hashed sessions and protocol projections. Restrict permissions, encrypt the storage destination and keep copies outside the application host. Configure a host scheduler for daily backups and verify restore regularly; no scheduler has been installed by this source change.

For a local Node deployment:

```sh
node --env-file=.env backend/backup.mjs /restricted/backups/rillvane.sqlite
```

For the container, a temporary in-volume backup can be created with:

```sh
docker compose -f ops/compose.yaml exec app node backend/backup.mjs /data/backup.sqlite
docker compose -f ops/compose.yaml cp app:/data/backup.sqlite ./restricted-backup.sqlite
```

Move/encrypt the exported file into restricted off-host storage. An in-volume backup alone does not protect against volume/host loss. The helper verifies backup integrity and applies mode 0600. Use a fresh destination per backup; the underlying SQLite API replaces an existing destination.

Restore procedure:

1. Stop the service and preserve the old database volume for investigation. Restore into a **fresh** volume/directory so stale `-wal`/`-shm` files cannot be paired with the backup. Set ownership for the runtime UID.
2. Open the copy with SQLite and run `PRAGMA integrity_check`; require `ok`.
3. Revoke restored sessions and challenges (`DELETE FROM sessions; DELETE FROM challenges;`) before exposing the service; backups can contain sessions that were later revoked.
4. Point `DATABASE_PATH` to the restored copy. Run preflight and start with the integrated worker. Existing expired job leases become retryable. Check queue counts and a generated test wallet login.
5. Verify wallet queries and tracking against the chosen RPC provider.

Retention: expired auth records/rate buckets are pruned every minute by the worker; notifications and completed transaction history after 30 days; audit records after 90 days. Intent idempotency records are retained with protocol wallets. Do not run with `WORKER_ENABLED=false` in the normal deployment, because scheduled maintenance and keepers would stop.

## Rollback and shutdown

SIGINT/SIGTERM stop new worker claims, wait for active reads, close HTTP connections, then close SQLite. Retain a 120-second container stop grace. Migrations are additive; back up before deployment. Rollback must use a build that understands the current schema, or restore a matching pre-upgrade backup with the session-revocation procedure. Never silently downgrade an unknown future schema.

## Verification limits and launch gates

Automated tests exercise generated Ed25519 signatures, API authorization/isolation, idempotency, conservation, config failure, network mismatch/failover, worker state transitions, lease recovery, shutdown, durable limits, migrations and backup restore. RPC responses are mocked. Live provider access, browser wallet signing, Docker, TLS, capacity, external monitoring, off-host restore and audit review still require deployment-environment validation.

Completing the financial backend requires decisions D01–D10 in `docs/BACKEND_REQUIREMENTS.md`: execution invariant, depositor claims, liquidity reservations, losses, real mints/issuer rules, credit/interest/liquidation rules, order model, oracle/session policy and authorities. Those determine the Solana programs, SDK, quote construction, program indexer and keeper implementation. No mainnet launch, token creation or real-funds action is authorized or performed by these files.

Technical references: [Solana RPC transaction status](https://solana.com/docs/rpc/http/getsignaturestatuses), [confirmed/finalized transaction reads](https://solana.com/docs/rpc/http/gettransaction), [Solana cluster genesis configuration](https://github.com/solana-labs/cluster/blob/master/service-env-devnet.sh), [Node 24 SQLite backup](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html).
