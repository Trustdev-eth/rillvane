# Rillvane full source handoff — version 15

## Run

Requires Node.js 24. From this folder:

```sh
npm run check
npm run test:ui
npm run test:backend
npm run backend
```

Open http://localhost:8787/app/. For a configured TLS deployment, read `ops/RUNBOOK.md`, `backend/.env.example`, `Dockerfile`, and `ops/compose.yaml`. Run the preflight before deployment. Keep secrets outside the repository. No npm installation is needed for runtime.

## Included

This export includes the latest modal layout, deposit/withdraw padding and scrollbar fixes from published version 15.

Animated landing journey, interactive terminal and app, accessible motion system, sample chart replay, local fonts and licenses, wallet sign-in, persistent demo accounts, verified read-only devnet RPC, durable signature observer/notifications, migration/audit/rate-limit/metrics/backup tooling, CI and deployment configuration.

## Status

Financial trade/supply/borrow actions remain simulated. No Solana financial programs, real quotes/feed, oracle integration, liquidation, protocol indexer or mainnet execution are implemented. The public Site is static and does not host the Node backend. This source adds operational infrastructure; it does not complete the production financial protocol. The backend needs a Node/container host, dedicated devnet RPC credentials, DNS/TLS, monitoring and recovery validation. Live public-devnet connectivity was not verified here (probe timed out). Docker/TLS deployment has not been executed. Eighteen automated tests pass; RPC tests use mocks.

See `docs/BACKEND_REQUIREMENTS.md` for the remaining financial design and implementation gates, `ops/RUNBOOK.md` for operations, and `brand/LAUNCH.md` for the separate community-token preparation. No token was created.

## Assets and Site identity

The retained Everswap/Lusion reference landscape, camera and texture assets must be licensed or replaced before a production commercial launch; see README and asset notes. App font licenses are included. The `.openai/hosting.json` project identity belongs to the existing Rillvane Site. Do not reuse that identity when creating a separate Site. Git history, runtime state and credentials are excluded.
