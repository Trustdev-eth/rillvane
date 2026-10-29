# Rillvane — Backend and Solana Protocol Requirements

Engineering handoff · 28 October 2026 · Specification version 1.1

**Implementation:** the RLVN/USDC protocol MVP is in this repository (`docs/ECONOMICS.md`, `programs/rillvane`, `backend/`, `/api/v1`). This file remains the original gap analysis. Live product copy and public JSON do not use the historical demo/devnet labels below.

**Status:** one integer-math market, wallet-signed intents, and local-validator bootstrap exist. Mainnet, extra tickers, CLOB, and independent audit remain out of scope. “Must” in later sections denotes a proposed acceptance requirement from the original analysis.

## 1. Product and scope

Rillvane presents tokenized-asset trading, single-asset supply, and collateral-backed USDC borrowing in one workspace. The production target is an independently specified Solana protocol with connected liquidity. The backend supplies identity, data, quoting support, transaction preparation, indexing, monitoring and operational controls. Solana programs enforce custody, settlement, accounting and financial limits.

The existing user flows remain: Trade, Markets, Supply, Borrow, Portfolio, Activity and Risk. No additional landing-page scenes or financial products are required by this specification. The current terminal follows the supplied second visual reference: black canvas, vivid green/red outlined candles, and indigo/purple controls. Appearance settings, focus mode, depth visibility and navigation density are interactive.

The proposed RLVN community coin is a separate workstream. Its creation does not implement trading, lending, vaults, or protocol governance. No token utility, revenue entitlement, staking yield, allocation or supply has been approved.

### Delivery boundaries

| Layer | Included in source now | Required production work |
| --- | --- | --- |
| Landing | Scroll narrative, 3D landscape, protocol reader, responsive UI | Own/license retained reference assets; align public claims with actual release |
| Terminal/app | Interactive demo charts, depth/tape, market/limit tickets, supply, credit, portfolio, activity, risk | Connect verified feeds, programs, real quotes and transaction lifecycle |
| Authentication | Domain-bound wallet signatures, expiring cookie sessions, per-wallet/session limits, durable abuse buckets | Distributed edge controls, wallet/account switching and independent operational review |
| Wallet reads | Devnet SOL and SPL/Token-2022 balances; full genesis verification and bounded RPC failover | Production issuer/mint allowlist, extension handling and live-provider validation |
| Account storage | Migrated SQLite JSON demo accounts, revisions, audit, leased tracking jobs, notifications and verified online backups | Production financial read models, distributed storage and chain reconciliation |
| Trade/supply/credit | Server-validated simulations | Full on-chain accounting and execution; no floating-point financial ledger |
| Solana programs | None | Implement, test, review and deploy protocol instructions and authorities |
| Oracles/indexer/keepers | Read-only authenticated transaction observer; no protocol indexer, oracle or financial keeper | Build program indexing, oracle and keeper logic; test stale data, forks and outages |
| Token launch | Logo, 1000px image, metadata template and preparation notes | Final naming/terms, actual wallet-approved creation, verified mint and links |

## 2. Current implementation: what a developer can run

Requires **Node.js 24 or later**. The current app/backend has no external npm runtime dependencies; the frontend includes its runtime assets. From the extracted `rillvane/` directory:

```sh
npm run check
npm run test:backend
npm run backend
```

Open `http://localhost:8787/app/`. The backend serves both `dist/` and `/api/`. With the backend available, wallet connection controls appear. The hosted Site currently serves the static frontend only; its actions remain browser-local simulations.

For environment configuration, copy `backend/.env.example` to `.env`, edit it, and run:

```sh
node --env-file=.env backend/server.mjs
```

| Current variable | Default | Meaning |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | HTTP bind address |
| `PORT` | `8787` | Local API/frontend port |
| `PUBLIC_ORIGIN` | `http://localhost:8787` | Exact origin accepted for POST requests |
| `SOLANA_CLUSTER` | `devnet` when configured | Entrypoint rejects other configured cluster names |
| `SOLANA_RPC_URL` | `https://api.devnet.solana.com` | Server-side read-only RPC endpoint; operator must choose a devnet endpoint |
| `DATABASE_PATH` | `./rillvane.sqlite` | Persistent demo database; explicit mounted path required in production mode |
| `NODE_ENV` | Development when unset | `production` enforces HTTPS origin, database path and operator secret |
| `SOLANA_RPC_URLS` | Falls back to single URL | One or two HTTPS devnet read providers; full genesis checked |
| `OPS_TOKEN` | Disabled when unset | At least 32 random characters in production; server-only operator read access |
| `EXECUTION_MODE` | `demo` | Other values rejected |
| `WORKER_ENABLED` | `true` | Integrated tracking/maintenance worker; keep enabled for normal operation |

Current authentication uses a five-minute single-use challenge and Ed25519 verification. Sessions expire after 24 hours; token hashes are stored in SQLite. Cookies use HttpOnly and SameSite=Strict, with Secure on HTTPS origins. POST requests check the exact Origin and JSON content type. There is a 16 KiB body limit, SQLite-backed 120 API requests/IP/minute and 24 auth requests/IP/minute, plus 8 challenges/wallet/minute and at most five active sessions per wallet. Proxy forwarded-IP headers are ignored; edge rate controls are required for fair per-visitor limits behind a reverse proxy. These are single-host controls, not a completed financial production security design.

The database contains versioned migrations, `challenges`, `sessions`, `accounts`, `requests`, `audit`, `rate_limits`, `chain_transactions`, `jobs` and `notifications`. Accounts remain JSON demo snapshots; `requests` provides atomic idempotency results. The integrated worker leases/retries read-only signature observations and inserts notifications atomically. A distributed rate limiter, external market feed, signer service and protocol event indexer are not present. Backups use SQLite online backup and integrity verification; a restore procedure is supplied in `ops/RUNBOOK.md`.

### Existing endpoints

| Method | Endpoint | Existing behavior |
| --- | --- | --- |
| GET | `/api/health` | Reports devnet/demo mode and mainnet disabled |
| GET | `/api/markets` | Returns labelled sample assets and pools |
| POST | `/api/auth/challenge` | `{wallet}` returns message, nonce and expiry |
| POST | `/api/auth/verify` | `{nonce, signature}` verifies base64 Ed25519 signature; returns demo account and session cookie |
| POST | `/api/auth/logout` | Revokes current session |
| GET | `/api/account` | Returns authenticated demo state and revision |
| GET | `/api/wallet` | Reads authenticated wallet SOL and token accounts on configured devnet RPC |
| POST | `/api/demo/action` | Applies validated simulated action with account revision and `Idempotency-Key` |
| GET/POST | `/api/chain/transactions` | List/track owned-wallet devnet signatures; observer only, no construction/submission |
| GET | `/api/notifications?after=<id>` | Cursor-based per-wallet state-change notifications |
| POST | `/api/notifications/read` | Acknowledge one owned notification |
| GET | `/livez`, `/readyz` | Process liveness and database/verified devnet readiness |
| GET | `/api/ops/metrics`, `/api/ops/audit` | Operator-authenticated metrics and audit cursor API |
| — | `/api/mainnet/*`, `/api/transactions` | Live execution guard; unavailable, no financial transaction implementation |

Demo actions include market/limit trade, cancellation, supply/withdraw, collateral add/remove, borrow/repay and reset. Sample limit orders remain open until cancelled; no matcher or conditional execution worker fills them. Sample prices and rates are fixed illustrative inputs. The demo uses floating-point amounts and a 65% borrowing limit; these are not approved production risk parameters.

The included tests cover generated Ed25519 signatures, replay/expiry, origin checks, authentication/logout, idempotency, revisions, persistence across restart, order reserves, accounting conservation, credit-limit rejection and live-execution guards. RPC responses are mocked in tests. Passing these tests is not evidence of deployed contracts, provider connectivity, economic soundness or a security audit.

## 3. Decisions required before financial implementation

These are release-blocking design decisions. They cannot be inferred from a landing animation or from the term “single-asset pool.”

| Decision | Required written outcome | Why it blocks implementation |
| --- | --- | --- |
| D01 — Pricing/execution model | Mathematical specification for an AMM, inventory-priced pool, RFQ system, or chosen combination | Determines executable prices, arbitrage exposure and capital requirements |
| D02 — Supply claims | Define whether a depositor owns asset units, pool NAV shares, or distinct asset-denominated tranches | A share can change exposure as trading changes inventory; the UI cannot promise fixed redemption without backing |
| D03 — Unified liquidity | Specify inventory/USDC reserve relationships, reservations, credit allocation and withdrawal priority | Trading and lending must not simultaneously spend the same capital |
| D04 — Loss waterfall | Define who absorbs trading losses, oracle gaps, bad debt and issuer impairment | Required for solvency accounting, disclosures and liquidation design |
| D05 — Asset list | Actual mint addresses, token programs, decimals, issuer terms and eligible wallets | Tickers and underlying stock prices do not identify executable token markets |
| D06 — Credit model | Collateral factors, caps, interest curve, liquidation policy, reserve factor and debt accounting | Current sample 65%/75% values are not a production specification |
| D07 — Order model | Decide conditional limit orders versus a real order book; define partial fills, fees and escrow | An AMM does not automatically produce a CLOB or the displayed sample market depth |
| D08 — Price/session policy | Oracle products, token-basis valuation, freshness, confidence and market-hours rules | Equity reference prices can differ from token execution/redemption prices |
| D09 — Governance | Upgrade authority, parameter roles, pause rights, timelocks and key recovery | Defines the real administrative trust boundary |
| D10 — Launch scope | Initial markets, funded liquidity, caps, operator owners and community-token role | Determines what can truthfully be enabled and announced |

The proposed production baseline is **non-custodial user execution with isolated asset-market risk boundaries**. A market can use asset inventory and an explicitly allocated USDC settlement reserve without requiring users to deposit a matched pair. Exact receipt economics and shared-reserve accounting remain subject to D01–D04. This is a proposed architecture, not a claim that the current source implements it.

If an interim app merely routes trades/deposits to unrelated external protocols, label it as such. It must not be represented as implementing Rillvane's own unified pool model.

## 4. Architecture and trust boundaries

Proposed components:

| Component | Responsibility | Authority boundary |
| --- | --- | --- |
| Browser/client SDK | Wallet discovery, quote display, unsigned instruction review, user signing, status | Never holds backend operator secrets; cannot set authoritative balances |
| API service | Authentication, validation, registry, queries, quote preparation, simulation and optional signed-transaction relay | No authority to move arbitrary user funds |
| Quote/risk module | Deterministic pricing inputs, liquidity checks, exposure and collateral estimates | Off-chain preview; programs recheck enforceable conditions |
| Market data service | Licensed/reference feeds, verified trade tape, candles, stream snapshots | Prices carry source, timestamps, market session and data quality |
| Indexer/reconciler | Decode approved program activity, reconstruct positions, handle forks/restarts | Database is a projection of canonical chain state |
| Conditional-order worker | Detect eligible orders and propose execution | May execute only bounded, valid on-chain orders or explicitly signed intents |
| Liquidation/maintenance workers | Accrual maintenance where needed, unhealthy-position actions, alerts | Restricted operational keys; no blanket withdrawal privilege |
| Solana protocol programs | Custody, shares, debt, settlement, collateral, risk and authority checks | Financial source of truth |
| Operator control plane | Listing, caps, pause/unpause and governed upgrades | Separate privileged identity, multisig policy and audit trail |
| PostgreSQL | Durable indexed read models, jobs, sessions and operational records | Does not independently create money or override on-chain claims |
| Cache/queue | Rate limits, snapshots, fan-out and retry coordination | Disposable cache; never financial source of truth |

A TypeScript API/worker layer and Rust Solana programs are proposed implementation choices. Select and pin framework, SDK, Rust, Anchor (if used), CLI and database versions in lockfiles/toolchain files at implementation time. The existing Node/SQLite server can continue serving the demo; adopting a production stack is new work.

All environments must be separate: local validator, shared devnet, staging and mainnet. Each environment has its own program IDs, registry, RPC configuration, databases, queues, secrets and monitoring. Validate the RPC genesis/cluster identity rather than trusting an environment label. Demo routes, sample funds and reset actions must not exist in the production financial namespace.

## 5. Identity, wallet and access requirements

| ID | Requirement | Acceptance evidence |
| --- | --- | --- |
| AUTH-01 | Use a reviewed domain-bound wallet sign-in message with address, nonce, issued/expiry time, intended network and purpose | Cross-origin/domain, wrong-wallet and replay signatures are rejected |
| AUTH-02 | Enforce atomic single-use challenges and session expiry/revocation across multiple service instances | Concurrent replay grants at most one session; revocation takes effect everywhere |
| AUTH-03 | Use secure cookie/session handling and CSRF/origin controls suited to the deployment | Browser tests cover HTTPS, logout, expiry, session fixation and unauthorized cross-site writes |
| AUTH-04 | Distinguish public chain reads from authenticated account settings and private operational records | One wallet cannot read another wallet's private preferences or mutate its records |
| AUTH-05 | Handle wallet disconnect, account switch and cluster mismatch explicitly | Old wallet data/actions clear or reauthorize; a pending intent cannot silently switch owner |
| AUTH-06 | Never collect user seeds/private keys; a sign-in signature grants no transfer authority | No custody-secret fields or signing backdoors in API, logs or database |
| AUTH-07 | Protect challenge creation, quote traffic and RPC fan-out with distributed limits | Abuse tests cannot exhaust RPC/DB budgets through unauthenticated endpoints |

User wallet transaction signatures remain mandatory for user-initiated financial authority. A session cookie cannot authorize withdrawals. Public on-chain actions must remain protected by the programs even when submitted without the official frontend or API.

## 6. Asset registry and issuer integration

**ASSET-01:** Maintain an authoritative allowlist keyed by cluster, mint address and token program. Store symbol/name only as display metadata. Record decimals, issuer, supported extensions, oracle bindings, underlying instrument, market calendar, trading/supply/borrow enable flags and risk caps. Reject unsupported mints and wrong token programs.

**ASSET-02:** Evaluate token restrictions before listing: transfer fees, transfer hooks, freeze controls, delegates, account states, eligibility rules and required extra accounts. Support an extension only after deposit, trade, withdrawal and liquidation behavior is tested; otherwise disable the asset. Measure actual received token deltas when transfers can charge fees.

**ASSET-03:** Store issuer eligibility and redemption dependencies. If issuer verification is required, define how proof is obtained and checked without assuming wallet authentication proves eligibility. Do not route, seize or redeem assets through an address that cannot legally or technically receive them under issuer rules.

**ASSET-04:** Handle stock splits, dividends, token redenominations, issuer pauses, redemption suspension and delisting. Define how each changes valuation, quantity, historical charts and collateral. Do not conflate an underlying equity price with the token's immediate redeemable value.

**ASSET-05:** Version registry changes, attach effective time/slot, audit the actor and invalidate affected quotes. Display actual issuer and token-contract references. The current `NVDAx`, `SPYx` and other sample symbols are not approved live integrations.

## 7. Market data, candles and streaming

**DATA-01:** Select production sources for executable liquidity, token reference prices and underlying market context. Record licensing, coverage, rate limits and outage behavior. A listing is not complete until its exact mint and instrument are mapped to real supported data.

**DATA-02:** Build OHLCV for the current 5m, 15m, 1h, 4h and 1d views. Define base/quote units, UTC buckets, trade inclusion rules, empty buckets and adjustment handling. Verify open/close ordering, high/low bounds, volume and pagination. Do not populate missing candles with fabricated trading activity.

**DATA-03:** Replace the sample tape with actual approved-market fills. A real order book requires executable orders from the selected venue/model. If the protocol supplies quote curves or inventory levels instead, label that depth correctly; generated sample bids/asks must not appear as live liquidity.

**DATA-04:** Stream snapshots and sequenced deltas over authenticated/public channels as appropriate. Include timestamp, slot, sequence, source and stale state. Support reconnect/resume; if continuity cannot be proven, resnapshot. Bound subscriptions per client and apply backpressure.

**DATA-05:** Display market session and freshness. During data loss, show the last observation with a stale label and disable affected risk-increasing actions according to approved policy. Do not keep moving prices to make an inactive market look live.

## 8. Trading, quotes and limit orders

| ID | Requirement |
| --- | --- |
| TRADE-01 | Support market buy/sell against the initial approved USDC markets using D01's actual execution model |
| TRADE-02 | Quotes identify wallet/market/mints, exact input, estimated output, minimum output, all fees, impact, route, state/oracle version, expiry, network and program IDs |
| TRADE-03 | Return raw token quantities as integer strings; display decimals separately. Reject excess precision, invalid signs, zero, overflow and unsupported assets |
| TRADE-04 | Enforce max input/min output and deadlines on-chain. The contract must not trust the browser's received amount, price or fee |
| TRADE-05 | Account for transfer fees, ATA creation/rent, compute/priority fees and available SOL. User-visible estimates distinguish protocol costs from network costs |
| TRADE-06 | Reserve capital exactly once. Validate free liquidity, per-market inventory/exposure caps and concurrent activity atomically in programs |
| TRADE-07 | Enforce spread, price deviation, size and session guardrails from approved risk settings |
| TRADE-08 | Reject stale quotes or rebuild with explicit review when state changes materially. An expired quote cannot silently execute at a worse price |
| TRADE-09 | Reconcile fills from confirmed/finalized on-chain effects. An HTTP success or returned RPC signature is not a completed trade |

### Conditional limit orders

The current demo includes limit tickets, so a production release that enables them must implement a real execution model. Proposed requirements:

- Each order identifies owner, market, side, quantity, limit interpretation, expiry, fee limits, filled quantity and cancel authority.
- The owner authorizes escrow or a bounded signed intent. Off-chain reservation alone is insufficient to guarantee funds.
- A program validates execution price after the defined fees, remaining amount, nonce, expiry, market and allowed executor behavior. A keeper cannot substitute the output mint or recipient.
- Specify GTC/expiry, partial-fill policy, minimum lot size and dust handling. Enforce cancellation/fill races atomically and return the unfilled reserve exactly once.
- A “post-only” switch is meaningful only with a defined resting-order/maker model. Implement its real crossing rules or omit/disable it; comparing to a sample mid price is not production post-only behavior.
- Publishing an order book requires a real venue/order model. The existence of conditional orders does not by itself justify displaying a CLOB.
- Worker retries and duplicated messages must not cause duplicate execution. All order validity checks must survive a compromised worker.

## 9. Single-asset pools and supply accounting

**POOL-01:** Publish the approved invariant and accounting specification before implementing financial instructions. Explain which assets a pool owns, which assets it owes, where USDC settlement liquidity originates and how trading changes depositor exposure.

**POOL-02:** A user can deposit one approved asset per supported supply action. Define receipt shares, valuation, rounding, fees, minimum initial liquidity and redemption units. Protect against first-depositor/share-inflation attacks, direct token donations and unfavorable rounding. A marketing label must not imply inventory risk or losses are absent.

**POOL-03:** Define an accounting identity for cash, trading inventory, receivables, accrued fees, protocol reserves, outstanding LP claims and recognized losses. Prove that reservations, lending and withdrawals cannot count the same liquidity twice. Avoid unbounded iteration over depositors or positions.

**POOL-04:** Compute withdrawable capacity from actual liquidity and approved buffers/reservations. If insufficient, either reject with a clear amount or use a specified withdrawal queue. Choose FIFO/pro-rata behavior, cancellation, share locking, accrual during queuing and settlement priority. Queued claims cannot also trade or be redeemed twice.

**POOL-05:** Implement deposit, withdraw/request-withdraw, cancel-withdraw where supported, fee accrual and receipt queries. A minimum-received/share guard protects users from unexpected valuation changes. State transitions must be atomic with token movement.

**POOL-06:** Report realized fees, interest, net performance, utilization and withdrawal liquidity separately. Variable historical APY is not a guarantee. Define annualization windows and the effect of losses and trading inventory valuation.

**POOL-07:** Handle token freezes, transfer failures, pool pauses and issuer impairment without inventing availability. Reconcile receipt supply and program vault balances; alert on any unexplained difference.

## 10. Credit, interest, liquidation and bad debt

**CREDIT-01:** Start with the explicitly approved collateral assets and USDC debt product; SPYx in the UI is illustrative until its real mint and valuation are approved. Market isolation and any shared-liquidity borrowing limits must be specified.

**CREDIT-02:** Define borrow index/debt shares, interest time basis, utilization curve, reserve factor, repayment rounding, collateral factor, liquidation threshold, liquidation bonus, close factor, minimum debt and supply/borrow/exposure caps. Store parameters with version and change authority. Do not promote current demo values into production defaults.

**CREDIT-03:** Implement add collateral, remove collateral, borrow and repay. Every risk-increasing action revalues the position with a permitted fresh oracle and checks limits on-chain. Healthy deleveraging should remain possible under the approved incident policy; a generic pause should not unnecessarily block repayment.

**CREDIT-04:** Define health calculations, multi-asset haircuts if later enabled, accrued interest inclusion and conservative rounding. Backend estimates and contract calculations must agree at boundary values. Borrowing must not assume a price feed for an underlying stock is identical to the collateral token's liquid exit value.

**CREDIT-05:** Liquidation eligibility, collateral seizure and debt repayment are program-enforced and permissionless or explicitly permissioned by design. A keeper chooses opportunities but cannot invent a position's health, liquidate a healthy account or seize an arbitrary recipient's collateral.

**CREDIT-06:** Provide funded liquidation liquidity or defined execution routes. Test whether restricted tokens can reach the liquidator/venue, including freezes and transfer hooks. Model gaps, halts, weekends, closed markets and insufficient depth.

**CREDIT-07:** Specify partial liquidation, dust, insolvent positions, bad-debt recognition and the loss waterfall. An insurance/reserve fund cannot be advertised as protection unless funded, governed and accounted for.

**CREDIT-08:** The Risk screen must use current positions and parameter versions, distinguish estimates from enforceable limits, and show how price shocks affect health. Scenario exploration must never mutate a real position.

## 11. Oracles and market sessions

**ORACLE-01:** For each asset, specify exact feed IDs/accounts, provider/product, price exponent, confidence interpretation, publish time, supported sessions and permitted fallback. Verify signatures/account ownership/feed binding on-chain with the chosen integration. A generic backend-supplied number is not an oracle.

**ORACLE-02:** Reject invalid, stale, future-dated or out-of-order data according to a per-asset policy. Check confidence/deviation and liquidity before allowing risk increases. Specify conservative valuation for liabilities and collateral where appropriate.

**ORACLE-03:** Define separate behavior for trading, borrowing, collateral release, repayment and liquidation during closed markets or outages. Disabling new borrowing alone does not solve liquidation or inventory risk; record the complete policy and test it.

**ORACLE-04:** Alerts must identify stale feeds, provider failure, inconsistent sources, confidence expansion and session mismatches. Do not silently use an unrelated feed or a carried-forward value as a fresh executable price.

**ORACLE-05:** If no usable price exists, expose unavailable/degraded state rather than a fabricated mark. Manual emergency parameters require governed authorization, bounded duration and an immutable audit record.

## 12. Solana programs and client SDK

No program source, IDL or deployed program is included in the current package. The following are proposed logical account/instruction boundaries; they may be combined into fewer programs after security and account-lock analysis.

| Logical module | Required account/state concepts | Required instructions |
| --- | --- | --- |
| Configuration/registry | Protocol config, allowed markets/mints/programs, authorities, versioned risk parameters | Initialize, add/update market, pause/unpause, propose/activate governed changes |
| Pool/vault | Market, PDA authority, asset/USDC vaults, receipt supply, reserves, queue claims | Deposit, withdraw/request/cancel/settle, accrue fees |
| Trading/orders | Pricing state, inventory/exposure, user intent/nonces, optional order escrow | Swap, place/cancel/execute order, bounded partial fill |
| Credit/risk | Collateral vaults, position owner, debt/interest indices, liquidation state | Add/remove collateral, borrow, repay, liquidate, recognize approved bad debt |

**SC-01:** Define deterministic PDA seeds, canonical bumps, account versions and migration behavior. Validate signer, owner, discriminator/type, mint, token authority, market relationship and program IDs for every instruction. Wrong-market/wrong-vault account substitution must fail.

**SC-02:** Use integer raw units and checked fixed-point arithmetic. Specify scale, overflow bounds and direction of every rounding operation. Use wider intermediates where needed and test zero/tiny/maximum inputs. No `f64` financial accounting.

**SC-03:** Validate supported token programs/extensions and CPI targets. Restrict arbitrary CPI, duplicate mutable accounts, unexpected delegates/close authorities and authority substitution. Financial rules must not depend only on frontend or backend checks.

**SC-04:** Put slippage, expiry, position health, caps, receipt accounting and order replay protection inside settlement instructions. A malicious API or keeper must not bypass them.

**SC-05:** Emit versioned events with amounts, owner/market, state transitions and useful reconciliation identifiers. Indexers must validate the emitting program/context rather than trust arbitrary log strings. Handle log truncation by reconciling transaction/account state.

**SC-06:** Analyse Solana account contention, compute budgets, transaction/account size and large-account growth. A global writable reserve may become a bottleneck; shard or isolate only after preserving the approved economic accounting.

**SC-07:** Document upgrade, pause, parameter and emergency powers. Keep operational keys separate from upgrade control. Deploy with reviewed authority configuration and a documented recovery/rotation procedure.

**SDK-01:** Deliver typed instruction builders, account decoders, PDA helpers, amount conversion, error mappings, program IDs by environment and IDL/schema artifacts where applicable. Add golden test vectors shared by API, SDK and programs.

## 13. Transaction preparation, wallet approval and confirmation

Required lifecycle:

`quoted → prepared → awaiting_signature → signed → submitted → processed → confirmed → finalized`

Additional outcomes are `rejected`, `failed`, `expired`, `cancelled_before_submission` and `unknown`. Unknown is recoverable uncertainty, not proof of failure. Processed observations can disappear and must not be treated as final settlement.

**TX-01:** Prepare an unsigned transaction from validated intent and approved configuration. Return program/mint/account summary, expected balance changes, fees, quote expiry, blockhash and last-valid block height where applicable. Simulate before approval and surface actionable errors.

**TX-02:** Require the user's wallet signature for the exact financial transaction. A changed recipient, amount, route, program or expired/rebuilt message requires another wallet approval. Never sign on behalf of a user using server-held wallet secrets.

**TX-03:** An optional relay accepts only fully validated signed transactions in the supported flow, enforces payload limits and approved instruction/program boundaries, and returns the actual signature. Protect operational sponsorship budgets if fee sponsorship is added; it is not required for the initial release.

**TX-04:** Track confirmation using actual chain status and block-height expiration. Rebroadcasting the same signed bytes is distinct from constructing a new transaction. Do not conclude expiry solely from a wall-clock timeout.

**TX-05:** Financial intents need replay/duplicate protection beyond an HTTP idempotency key. Before renewing an uncertain intent, reconcile whether it already executed; use program-level nonces/order state or equivalent rules to prevent a second economically equivalent fill.

**TX-06:** Handle wallet rejection, insufficient SOL, stale blockhash, simulation failure, slippage rejection, node lag, account contention, provider outage and ambiguous send responses. Never show settled balances immediately after submit.

**TX-07:** Preserve a correlation ID linking quote, intent, wallet approval, transaction attempts, chain signature, program event and indexed result. Record timestamps and slots without logging secret credentials.

## 14. Indexing, reconciliation and portfolio

**INDEX-01:** Index approved program accounts/events and relevant token changes using a provider that supports the required history and streaming. Persist checkpoints and backfill from a known deployment slot. Restart without missed or duplicate effects.

**INDEX-02:** Maintain provisional and finalized observations with slot/block identity and commitment. Handle forks/dropped observations; make canonicalization explicit. Rebuild projections deterministically from durable observations plus verified account snapshots.

**INDEX-03:** Deduplicate events and transactions with stable program/signature/instruction/event identities. Validate event emitters and ordering. A duplicated webhook or out-of-order stream must not credit a user twice.

**INDEX-04:** Reconcile vault balances, receipt supply, positions, debt, order escrow and program reserves against chain state. A mismatch creates an alert and can disable affected risk increases; do not silently overwrite unexplained differences.

**INDEX-05:** Portfolio responses separately report spendable wallet tokens, escrowed order tokens, supplied claims, pledged collateral, accrued debt, fees and valuation timestamps. Prevent double-counting collateral or locked orders in net equity.

**INDEX-06:** Activity/CSV exports show real status, signature, amount/decimals, market, UTC timestamp and source. Separate demo history completely. Escape spreadsheet-formula prefixes in text fields and support pagination/reproducible export ranges.

## 15. Proposed production data model

These are new schemas, not existing SQLite tables. Store monetary amounts as integer strings/checked database numerics with explicit scales. Never use database floating-point fields as financial truth.

| Entity | Key data / constraints |
| --- | --- |
| Wallet identity / session | Address, network/domain context, hashed session token, expiry/revocation; no custody secrets |
| Asset / issuer / eligibility | Cluster+mint+token program unique; decimals, extensions, issuer rules and eligibility proof version |
| Market / parameter version | Market PDA, vaults, risk caps, oracle mapping, effective version/slot and pause state |
| Oracle observation | Feed identity, price/exponent, confidence, publication time, verified slot and quality/session |
| Quote | Quote ID, owner/context, input/output mints, raw amounts, fee breakdown, route, expiry and input-state versions |
| Intent / idempotency request | Owner+intent ID unique; request digest, validity window, on-chain nonce/order link and terminal result |
| Transaction attempt / observation | Actual signature, intent, blockhash validity, commitment, error and canonical slot/block context |
| Trade/fill / conditional order | Market, side, raw quantities, fees, order state, remaining escrow, cancel/fill identity |
| Supply / receipt / withdrawal request | Owner/market, shares/units, valuation basis, queued claim, status and chain provenance |
| Credit position / accrual snapshot | Collateral quantities, debt shares/index, parameter/oracle versions and health |
| Job / checkpoint / reconciliation | Work ID, lease, attempts, cursor/slot, provider, run result and discrepancy |
| Admin audit / incident / configuration | Actor/role, approved change, before/after hash, signature, reason and effective time |
| User settings | Watchlist/display preferences; cannot override financial parameters |

Define foreign keys, unique constraints, schema migrations, retention and read indexes. All projection writes must be transactional with their consumed-event checkpoint. Use an outbox or equivalent durable handoff for side effects; cache expiration must not lose financial work.

## 16. Proposed production API contract

Use a versioned namespace such as `/api/v1/`; do not silently repurpose `/api/demo/*` for real funds. OpenAPI/JSON Schema must define auth, raw amount formats, pagination, errors, time/slot semantics and idempotency behavior. Reject unknown or unsupported financial fields.

| Area | Proposed endpoints | Required behavior |
| --- | --- | --- |
| Health/config | `GET /health`, `/ready`, `/config` | Distinguish process readiness, dependencies, cluster, execution mode and approved program/config versions |
| Identity | `POST /auth/challenge`, `/auth/verify`, `/auth/logout`; `GET /auth/session` | Domain-bound sign-in, secure revocation and current address |
| Registry | `GET /assets`, `/markets`, `/markets/{id}` | Exact mints, eligibility, current risk flags/caps and data freshness |
| Market data | `GET /markets/{id}/candles`, `/trades`, `/depth` | Real sources, cursor/range limits, venue/depth meaning and stale status |
| Trading | `POST /quotes`, `/transactions/prepare`; optional `/transactions/relay` | Validated quotes and unsigned transaction preparation; no private-key custody |
| Status | `GET /intents/{id}`, `/transactions/{signature}` | Unknown/processed/confirmed/finalized and actual error/expiry state |
| Limit orders | `GET /orders`; `POST /orders/prepare`, `/orders/{id}/cancel/prepare` | Owner-scoped reads; on-chain-authorized placement/cancellation |
| Supply | `GET /pools`, `/pools/{id}`; `POST /supply/prepare`, `/withdrawals/prepare` | Position/available liquidity distinction and receipt/queue semantics |
| Credit | `GET /credit/positions`; `POST /credit/{add,remove,borrow,repay}/prepare` | Consistent valuation, projected health and on-chain constraints |
| Account | `GET /portfolio`, `/balances`, `/activity`, `/activity/export` | Canonical source, locked/pledged balances, raw units and pagination |
| Risk | `GET /risk/parameters`; `POST /risk/scenarios` | Versioned limits and read-only scenario output |
| User settings | `GET/PATCH /preferences` | Validated owner-specific nonfinancial preferences |
| Operations | Separate restricted listing/cap/pause/change interfaces | Strong privileged auth, approvals, audit and governed transaction preparation |
| Streaming | WSS `/stream` | Sequenced public/private topics, auth isolation, reconnect/resnapshot and limits |

Path examples in the table omit the `/api/v1` prefix for readability. Each mutating application request needs appropriate authorization and idempotency; user signatures/program state remain the final financial authority.

Error responses need stable codes including `INVALID_AMOUNT`, `UNSUPPORTED_ASSET`, `WRONG_NETWORK`, `QUOTE_EXPIRED`, `PRICE_STALE`, `MARKET_CLOSED`, `INSUFFICIENT_LIQUIDITY`, `SLIPPAGE_EXCEEDED`, `HEALTH_LIMIT`, `CAP_REACHED`, `ORDER_NOT_OPEN`, `IDEMPOTENCY_CONFLICT`, `RPC_UNAVAILABLE` and `TRANSACTION_UNKNOWN`. HTTP status and client recovery guidance must match the actual cause.

## 17. Workers and operational jobs

Required jobs include market/feed ingestion, approved on-chain indexing, reconciliation/backfill, conditional-order evaluation if enabled, liquidation opportunity evaluation, expired-session/challenge cleanup, idempotency retention, exports and monitoring.

Every job needs a durable identifier, lease/concurrency policy, bounded retries with backoff, timeout, metrics and dead-letter handling. Worker crashes between submission and acknowledgment must resume by reconciling the existing transaction, not executing a new financial action blindly. Keeper signing keys must have narrow permissions and bounded SOL spend; they must not be the protocol's unrestricted upgrade/custody authority.

Define which jobs are required for safety versus convenience. If a keeper is offline, on-chain validity checks still hold, but liquidation/execution liveness can deteriorate; expose and alert on that condition.

## 18. Security and administrative controls

- Threat model client tampering, malicious/compromised API and workers, hostile accounts, oracle latency, market manipulation, token extensions, concurrent actions and privileged-key compromise.
- Keep user custody secrets out of the service entirely. Store operator keys/provider credentials in a secret manager or reviewed signer boundary; rotate and scope access. Never include them in source exports.
- Restrict internal/admin networks and roles. Use stronger privileged authentication than ordinary wallet sign-in and a reviewed multisig/timelock policy for financial governance.
- Apply payload/schema validation, exact-origin/CSRF controls, rate limits, timeouts, request correlation, safe error messages and log redaction. Treat dependency/provider responses as untrusted input.
- Protect RPC and data subscriptions from fan-out abuse; do not accept arbitrary user-supplied RPC URLs or executable routes.
- Pin dependencies and toolchains, review changes, scan for secrets and verify reproducible program builds/artifacts. No placeholder program IDs may reach a mainnet configuration.
- Audit parameter changes, deploys, permission changes and incident actions. Preserve evidence independently of the application host.
- Scope pause controls per market and action. Document repayment, withdrawal and settlement behavior under each pause; “emergency” must not be an undocumented unlimited seizure power.
- Collect and retain only required identity/provider/eligibility data. Document data access, retention, deletion and incident handling with the relevant issuer/service owners.

## 19. Reliability, performance and observability

The following are **proposed initial engineering targets**, to be approved against a load test and deployment budget. They are not current service guarantees or promises of Solana finality.

| Measure | Proposed target / release evidence |
| --- | --- |
| Initial capacity profile | 100 HTTP requests/second and 1,000 concurrent market-stream clients; agreed market/subscription limits |
| Cached read latency | p95 under 300 ms at the approved capacity profile |
| Quote/preparation latency | p95 under 2 seconds with healthy dependencies; bounded timeout/degraded response otherwise |
| API availability | 99.9% monthly target; define dependency/outage classification explicitly |
| Index freshness | Track processed/confirmed/finalized lag separately; alert if healthy-network confirmed projection is more than 10 slots behind for 30 seconds |
| Financial integrity | No unexplained finalized-state reconciliation differences; any mismatch blocks affected risk increases until triaged |
| Database recovery | Proposed RPO no worse than 5 minutes and RTO no worse than 1 hour, demonstrated by restore drill |
| Chain history recovery | Demonstrated backfill from retained canonical events/accounts and provisioned historical RPC; document retention limits |

Monitor HTTP latency/error rates, auth failures, queue age, RPC latency/lag, feed freshness/confidence, transaction outcomes/expiry, program error codes, reconciliation mismatches, caps, utilization, liquidation backlog and worker SOL budgets. Dashboards must distinguish an API outage, an oracle outage and a network outage.

Use encrypted backups, point-in-time recovery where provisioned, tested restores and rollback procedures. The financial ledger cannot be “restored” to arbitrary old database balances; rederive authoritative positions from chain state. Stale caches are never an acceptable fallback for risk-increasing execution.

## 20. Test and validation requirements

| Test layer | Required cases before enabling funds |
| --- | --- |
| API/unit | Schema/amount precision, auth/session lifecycle, authorization, pagination, errors, per-route abuse limits and deterministic quote math |
| Idempotency/concurrency | Duplicate requests, same key/different payload, stale revisions, worker crash/retry, cancellation/fill races and duplicated provider events |
| Program adversarial | Wrong signer/owner/mint/PDA/market/program, duplicate mutable accounts, forged price inputs, unsupported extensions and replayed intents |
| Financial invariants | Asset/liability and share conservation, no double reservation/spend, correct fees/interest, bounded rounding, caps and allowed loss allocation |
| Supply | First deposit, zero/tiny/large amounts, donation/inflation, fee-on-transfer, full utilization, queue cancellation and blocked transfers |
| Credit/liquidation | Exact health boundaries, interest accrual, partial/full repay, unhealthy liquidation, healthy-account protection, bad debt and illiquid exits |
| Oracle/session | Stale/future/wrong feed, confidence spikes, closed market, halted issuer, basis dislocation and provider failover |
| Chain lifecycle | User rejects signing, expired blockhash, ambiguous submit, node lag, dropped fork, duplicate relay, failed simulation and insufficient SOL |
| Indexer/recovery | Deterministic replay, missed/truncated events, backfill, fork reconciliation, restart and backup restore |
| Integration | Local validator and devnet using actual built programs and explicit test mints; issuer/provider sandbox tests where available |
| UI/end-to-end | Market and limit workflows, supply, all credit actions, pending/failure states, wallet/network switching, responsive terminal and truthful data labels |
| Load/chaos | Approved capacity profile, exhausted provider budget, database/queue failure, keeper outage and circuit-breaker behavior |
| Independent review | Economic specification review, smart-contract security review and backend/transaction construction review; tracked remediation and retest |

The eight development-backend tests and three chart/preference tests cover only a small subset. They do not satisfy the on-chain, economic, live-provider or operational acceptance requirements above.

## 21. Deployment and configuration requirements

Production requires a server/worker deployment that supports the chosen API architecture, persistent production database, durable queues/checkpoints, live RPC/data providers, program deployments and secure operator controls. The existing static hosting manifest publishes `dist/` only and does not deploy the Node backend or any program.

Proposed production configuration categories:

| Category | Required configuration |
| --- | --- |
| Environment | Public origin, cluster/genesis expectation, execution-mode flags and release ID |
| Programs | Reviewed program IDs, IDL/schema hashes, deployment slots, upgrade authority and parameter versions |
| RPC/indexing | Primary/fallback HTTP and stream endpoints, credentials, commitment, historical retention and spend limits |
| Database/queue | Connection credentials, migration revision, pool sizes, retention, backup destinations and encryption/access policy |
| Markets | Exact mint/token program registry, issuer integration, decimals, enabled actions and caps |
| Oracles/data | Product/feed IDs, source credentials, age/confidence/session policies and provider limits |
| Authentication | Allowed origins, cookie/session configuration, revocation store and privileged identity provider |
| Operations | Multisig/governance references, keeper signer references, spend ceilings, alerts and incident contacts |
| Optional token display | Actual verified RLVN mint, metadata URL and explorer links after creation |

Secrets must be injected at runtime; `.env.example` contains names/placeholders only. Validate required configuration at startup and reject network/program mismatches. CI must run checks, tests and migration validation before a controlled release. Program upgrades require the separately approved governance process, not an ordinary web deploy.

## 22. Community token / Pump.fun workstream

The supplied `brand/` folder contains a proposed Rillvane/RLVN identity, logo and metadata template. The template still has public-URL placeholders. No mint address or token creation transaction exists.

Requirements are to finalize and clear the identity, approve token description/terms, publish durable artwork and metadata, review the official creation flow, and have the wallet owner review/approve creation. Record and verify the actual mint and transaction before exposing token links. Do not promise unapproved ownership, yield or protocol-revenue rights.

Keep token creation outside the ordinary user trading API. Do not add a private-key upload or automated launch endpoint to the backend. RLVN must not automatically become collateral, a receipt share or a risk reserve; each would require a separate approved economic/security design. No custom memecoin token contract is assumed for a platform-managed launch.

## 23. Milestones, dependencies and acceptance gates

| Milestone | Deliverable | Gate |
| --- | --- | --- |
| M0 — Economic specification | D01–D10 decisions, invariants, worked examples, threats and parameter ownership | Approved model and quantified failure/loss scenarios |
| M1 — Production application foundation | Hardened identity, registry, schemas, APIs, real read-only data/indexer and operational environment | Reconciliation/recovery and environment separation demonstrated |
| M2 — Protocol development | Programs, SDK, integer accounting, tests, actual local-validator/devnet integration | Invariants and adversarial tests pass; no demo ledger in live flow |
| M3 — Full flow integration | Trading, real order model if enabled, supply, credit, oracle/session policies, keepers and streams | End-to-end chain-state settlement with failure/retry tests |
| M4 — Review and operations | Independent reviews, remediation, load/chaos/restore tests and incident drills | Release blockers resolved and operator ownership assigned |
| M5 — Controlled mainnet release | Verified builds/IDs/authorities, actual assets/providers, funded liquidity and initial caps | Explicit release approval, monitoring, rollback/pause readiness |

Do not attach fixed delivery dates or an audit-completion claim without an implementation estimate and reviewer availability. A community coin launch can have a different timeline but must not be described as completion of M2–M5.

### Mainnet completion checklist

- Approved economics and all initial risk parameters; no unresolved D01–D10 blocker.
- Exact eligible mints, issuer dependencies, transfer restrictions and data/oracle coverage verified.
- Reviewed programs deployed with verified IDs, builds and authority configuration.
- Wallet-signed transactions enforce financial limits on-chain; unknown outcomes reconcile safely.
- Real deposits, shares, debt, orders and withdrawals match chain state with no unexplained differences.
- Liquidation liquidity, keeper liveness, bad-debt handling and market-hours behavior tested.
- Auth, secrets, backups, monitoring, incident response and operational change controls validated.
- Frontend uses real data/status and separates estimates from enforceable terms.
- Reference-owned landscapes/camera assets licensed or replaced, and release claims accurately reflect available functions.

## 24. Required handoff artifacts from implementation

Completion means delivering: production API/worker source and lockfiles; Rust program source and pinned toolchains; SDK/IDL/account schemas; database migrations; OpenAPI and streaming schemas; economic and risk specifications; test suites/results; environment templates; deployment manifests; verified program/authority registry; provider/issuer integration notes; reconciliation/backfill tools; monitoring dashboards/alerts; backup/restore and incident runbooks; review reports and remediation evidence.

The current package contains the frontend, devnet/demo API, durable read-only transaction worker, service migrations, tests, container/CI configuration, environment templates, operational runbook and branding described in section 2. It does not contain financial Solana programs, an actual protocol SDK/IDL, real feeds, a protocol indexer, liquidation keepers or audit evidence. This requirements document is not a substitute for those implementation artifacts.

## 25. Official technical references checked

The architecture, thresholds and acceptance criteria above are project proposals. The following official sources support specific integration considerations and must be rechecked against the exact pinned implementation versions.

1. Solana — [Transaction Confirmation & Expiration](https://solana.com/developers/cookbook/transactions/confirmation). Recent blockhash validity and commitment alignment matter; confirmation/expiry must use chain status and the blockhash validity information rather than a single fixed wall-clock timeout.
2. Solana — [Token extensions](https://solana.com/docs/tokens/extensions) and [Transfer Hook](https://solana.com/docs/tokens/extensions/transfer-hook). Extensions can change transfer behavior and account requirements; support must be explicitly tested per mint.
3. Anchor — [Account constraints](https://www.anchor-lang.com/docs/references/account-constraints). Use the selected version's signer/account/PDA/address/authority validation mechanisms. This document does not mandate syntax from an unpinned version.
4. Pyth — [Solana/SVM integration](https://docs.pyth.network/pro/use-prices-on-blockchain/solana) and [Best practices](https://docs.pyth.network/pro/best-practices). Select the relevant product, verify the right feed/update and implement freshness, confidence and session controls. Provider suitability and feed availability for the actual issuer token remain to be established.
5. Pump.fun — [Official creation page](https://pump.fun/create). Review the current form and immutable creation details immediately before the owner's token-creation action. No platform fees, supply configuration or launch transaction are assumed here.
