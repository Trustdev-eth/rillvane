# Rillvane application backend

Node origin for the RLVN/USDC market: integer protocol engine, wallet sign-in, quotes, signed intents, and SQLite projections.

## Run locally

Requires Node.js 24.

```sh
node scripts/bootstrap.mjs
npm run backend
```

Open `http://localhost:8787/app/`. Connect Phantom or Solflare, sign in, claim the faucet, then supply, swap, post collateral, borrow, repay, and withdraw. Each instruction is wallet-signed.

Copy `backend/.env.example` to `.env` and load it with `node --env-file=.env backend/server.mjs`. `PUBLIC_ORIGIN` must match the browser origin. Production requires HTTPS, `OPS_TOKEN` (≥32 characters), and an absolute `DATABASE_PATH`. Mainnet is rejected. `EXECUTION_MODE` must be `protocol`.

## API

| Method | Endpoint | Behavior |
| --- | --- | --- |
| GET | `/api/health` | `{ok:true}` |
| GET | `/api/v1/config` | Market, mints, LTV, fee, APR |
| GET | `/api/v1/markets` | RLVN/USDC oracle and inventory |
| GET | `/api/v1/pool` | Cash, debt, NAV, utilization |
| GET | `/api/v1/candles` | Executed-swap candles |
| GET | `/api/v1/trades` | Recent fills |
| POST | `/api/auth/challenge` | `{wallet}` → origin + wallet + nonce |
| POST | `/api/auth/verify` | `{nonce, signature}` → session cookie |
| POST | `/api/auth/logout` | Revoke session |
| GET | `/api/account` | Authenticated workspace snapshot |
| GET | `/api/v1/me/portfolio` | Balances, shares, collateral, debt |
| GET | `/api/v1/me/activity` | Settled instructions |
| POST | `/api/v1/quotes/{swap,supply,withdraw,credit}` | 15s quote, decimal strings |
| POST | `/api/v1/intents` | Idempotent intent; returns message |
| POST | `/api/v1/intents/:id/prepare` | Unsigned bytes + optional blockhash |
| POST | `/api/v1/intents/:id/submission` | Verify signature, apply instruction |
| POST/GET | `/api/v1/faucet/claims` | Daily USDC/RLVN faucet |
| GET | `/api/wallet` | SOL and token accounts |
| GET/POST | `/api/chain/transactions` | Track signatures |
| GET | `/livez`, `/readyz` | Liveness and RPC/database readiness |
| GET | `/api/ops/metrics`, `/api/ops/audit` | Operator bearer diagnostics |

Writes require `Origin` matching `PUBLIC_ORIGIN` and an `Idempotency-Key` on intents and faucet claims.

## Workers

The process ticks confirmation jobs, refreshes the oracle timestamp, liquidates positions at 60% LTV, and indexes swap events into `trades`. Protocol tables are isolated from legacy `accounts` JSON.
