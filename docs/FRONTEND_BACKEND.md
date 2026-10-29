# Connected mountain workspace

The frontend in `dist/` uses the project's same-origin backend. Open `/app/` on the Node server or the combined Cloudflare Worker, rather than serving `dist/` by itself.

## Local development

Requires Node.js 24. Run `npm ci` when installing from a fresh checkout, then:

```sh
npm run dev
```

This loads the existing `.env` if present and serves the frontend, API, wallet sessions, and WebSocket stream together. The default app URL is `http://localhost:8787/app/`. `PUBLIC_ORIGIN` must match the exact browser origin. Keep registry and authority configuration server-side.

## Integration

- `/api/health`, public market/pool/trades/candles endpoints, and `/api/v1/stream` feed the app. The connection indicator reports availability and retries recover from transient failures.
- Wallet sign-in uses the backend challenge and same-origin session cookie. Reload restores the session; signing out revokes it.
- Swap quotes include the selected slippage in basis points. The reviewed minimum output comes from the backend. Out-of-order responses cannot replace a newer amount or order side.
- Supply and withdrawal reviews use backend quotes. Withdrawal inputs are shares; the review separately shows the asset proceeds.
- Backend workspace snapshots expose both share balances and redeemable supplied assets. Dashboard and portfolio values use the redeemable assets.
- Intents have a two-minute signing window; market quotes remain valid for 15 seconds. An expired quote must be refreshed before creating a new intent.
- Prepared on-chain transactions are decoded into real Solana transaction objects before wallet signing. Rejected transaction signing is surfaced to the user and is not silently replaced by message-only authorization.
- `dist/vendor/solana-wallet.js` is a locally bundled transaction decoder. Run `npm run build:wallet` after dependency changes. No runtime CDN is required. The pinned v1 SDK matches the injected-wallet interface; the scoped Jayson 5 override removes outdated transitive dependencies. `npm audit` reports no vulnerabilities for the resulting lockfile.

Transaction decoding follows the [Solana v1 transaction API](https://solana-foundation.github.io/solana-web3.js/v1.x/classes/Transaction.html). Existing logo assets and mountain artwork are preserved.

## Deployment

For the VPS and custom-domain setup, follow [VPS hosting](VPS_HOSTING.md): Caddy serves the landing domain and proxies `app.rillvane.trade` to Node. Set `PUBLIC_ORIGIN=https://app.rillvane.trade` and `SITE_MODE=app`; the workspace then opens at `/`. Wallet sessions, API calls and WebSockets stay on that origin. Local `SITE_MODE=combined` keeps the app at `/app/`.

The older Cloudflare deployment remains available as an alternative:

```sh
npm run deploy:cloudflare
```

This rebuilds the local wallet bundle, checks syntax, and deploys the current Worker and `dist/` assets together using `wrangler.jsonc`. Existing Durable Object storage and configured secrets stay with the existing Worker. A static Sites publication does not run this backend.

## Verification

```sh
npm run check
npm run test:backend
npm run test:ui
npm run test:integration
node tools/mountain-browser-check.mjs
```

The integration browser test uses an ephemeral Ed25519 wallet, an in-memory database, a mocked RPC, and a synthetic transaction fixture. It exercises sign-in, both faucets, supply, swap, slippage, quote races, collateral, borrow/repay, withdrawal, synchronized views, recovery, session restoration, and logout. It does not use the configured keys/database or broadcast a blockchain transaction. Real-wallet transaction execution still requires a wallet confirmation on the configured chain.
