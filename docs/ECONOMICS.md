# Rillvane protocol economics

Version 1.0 · G01–G05 locked for the MVP. TypeScript (`backend/math.mjs`) and the Rust program use these integer rules only. No floating-point custody, debt, shares, or settlement.

## Market

One pair, six decimals, SPL Token program only.

| Role | Symbol | Meaning |
| --- | --- | --- |
| Base | RLVN | Protocol asset |
| Quote | USDC | Settlement asset (protocol mint) |

`UNIT = 1_000_000`. `PRICE_SCALE = 1_000_000`. Oracle price `100_000_000` means 100 USDC per 1 RLVN.

## G01 — Trade pricing

Exact-input inventory pool. Oracle is the mark; execution applies fee and size impact.

- Buy RLVN: `gross = amount_in * PRICE_SCALE / price`
- Sell RLVN: `gross = amount_in * price / PRICE_SCALE`
- `impact_bps = min(190, amount_in * 10_000 / cash)` where cash is quote inventory for buys and base inventory for sells
- `out = gross * (10_000 - 10 - impact_bps) / 10_000` (10 bps fee)
- Reject `out == 0`, `out < min_out`, past `deadline`, or `|exec_price - oracle| * 10_000 / oracle > 500`
- Buy execution price: `amount_in * PRICE_SCALE / out`. Sell: `out * PRICE_SCALE / amount_in`

## G02 — Supplier claims

Single-asset NAV shares. Collateral is not in NAV.

- `nav_quote = quote_cash + quote_debt`
- `nav_base = base_cash`
- First deposit: `shares = amount`
- Later: `shares = amount * total_shares / nav`
- Redeem: `assets = shares * nav / total_shares` (floor)

## G03 — Shared cash

`quote_vault = quote_cash`. Outstanding loans are receivables (`quote_debt`), not spendable cash.

`min_cash = nav_quote * 1_000 / 10_000` (10% floor). Swaps, loans, and withdrawals must leave `quote_cash >= min_cash` after the action. The same units cannot pay a swap, a loan, and a withdrawal.

## G04 — Credit

| Parameter | Value |
| --- | --- |
| Max borrow LTV | 50% |
| Liquidation threshold | 60% |
| Liquidation bonus | 5% |
| Close factor | 50% |
| Borrow APR | 8% fixed |
| Index scale | `1e12` |
| Year | 365 × 24 × 3600 seconds |

`ltv_bps = debt * PRICE_SCALE * 10_000 / (collateral * price)`

Accrue before any health-dependent instruction:

`index' = index * (INDEX_SCALE + 800 * INDEX_SCALE * dt / (10_000 * seconds_per_year)) / INDEX_SCALE`

`debt = debt_shares * index / INDEX_SCALE`

Liquidation vector (no interest): 100 RLVN at 100, debt 4_000 USDC, price 60 → LTV 66.67%. Repay 2_000 USDC, seize 35 RLVN.

## G05 — Authorities

Four distinct keypairs: upgrade, oracle updater, faucet mint, liquidation keeper. None are shipped in frontend assets.

Oracle: updater only; price > 0; reject updates older than the last publish or older than 30 seconds at use for risk-increasing actions. Repay and add-collateral remain allowed when the feed is stale.
