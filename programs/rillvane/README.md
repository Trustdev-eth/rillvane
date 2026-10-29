# Rillvane program

Native inventory pool, single-asset claims, and RLVN-collateral USDC credit.

Integer math in `src/math.rs` is the on-chain copy of `backend/math.mjs`. Run `cargo test -p rillvane` for the liquidation and interest vectors.

Build with `cargo-build-sbf` and deploy with `node scripts/deploy-devnet.mjs`. The Node engine (`backend/engine.mjs`) mirrors the same integer instructions for quotes and local tests.
