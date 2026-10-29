//! Instruction-level vectors. Same rules as `backend/engine.test.mjs`.
//! Run with `cargo test -p rillvane` until SBF local-validator tests are enabled.

use rillvane::math::{
    deposit_shares, liquidation, ltv_bps, max_borrow, redeem_assets, swap_out, MAX_LTV_BPS,
    START_PRICE, UNIT,
};

#[test]
fn deposit_bootstrap_then_redeem() {
    let first = deposit_shares(1_000 * UNIT, 0, 0).unwrap();
    assert_eq!(first, 1_000 * UNIT);
    let out = redeem_assets(first, first, 1_000 * UNIT).unwrap();
    assert_eq!(out, 1_000 * UNIT);
}

#[test]
fn swap_both_directions_and_insufficient_liquidity() {
    let buy = swap_out(true, 50 * UNIT, START_PRICE, 10_000 * UNIT, 1_000_000 * UNIT).unwrap();
    let sell = swap_out(false, buy.out, START_PRICE, buy.base_cash, buy.quote_cash).unwrap();
    assert!(sell.out > 0);
    assert!(swap_out(true, UNIT, START_PRICE, 0, 0).is_err());
}

#[test]
fn ltv_reject_and_liquidation_vector() {
    assert_eq!(max_borrow(100 * UNIT, START_PRICE, 0), 5_000 * UNIT);
    assert!(ltv_bps(4_000 * UNIT, 100 * UNIT, START_PRICE) < MAX_LTV_BPS);
    let (repay, seize) = liquidation(4_000 * UNIT, 100 * UNIT, 60_000_000).unwrap();
    assert_eq!(repay, 2_000 * UNIT);
    assert_eq!(seize, 35 * UNIT);
}

#[test]
fn stale_oracle_price_is_rejected() {
    assert!(swap_out(true, UNIT, 0, 10_000 * UNIT, 1_000_000 * UNIT).is_err());
}

#[test]
fn protocol_pdas() {
    let pid = rillvane::id();
    let (config, _) = solana_program::pubkey::Pubkey::find_program_address(&[b"config"], &pid);
    let (market, _) = solana_program::pubkey::Pubkey::find_program_address(&[b"market"], &pid);
    let (oracle, _) = solana_program::pubkey::Pubkey::find_program_address(&[b"oracle"], &pid);
    println!("program {pid}");
    println!("config {config}");
    println!("market {market}");
    println!("oracle {oracle}");
    assert_ne!(config, market);
}

#[test]
fn associated_token_address() {
    use std::str::FromStr;
    let token = solana_program::pubkey::Pubkey::from_str("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA").unwrap();
    let ata_prog = solana_program::pubkey::Pubkey::from_str("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL").unwrap();
    let owner = solana_program::pubkey::Pubkey::from_str("CuB3DTHwqLTSzcWZtF7WHPt4fgCto8kdjsXcUZJa9BaG").unwrap();
    let mint = solana_program::pubkey::Pubkey::from_str("GHKc9Vigvn5murV4Bhf9QXni3m9yHkbMZS6Se6FtmZDb").unwrap();
    let (ata, bump) = solana_program::pubkey::Pubkey::find_program_address(
        &[owner.as_ref(), token.as_ref(), mint.as_ref()],
        &ata_prog,
    );
    println!("ata {ata} bump {bump}");
}
