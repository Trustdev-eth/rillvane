//! Integer economics shared with `backend/math.mjs`. No floating point.

pub const DECIMALS: u8 = 6;
pub const UNIT: u128 = 1_000_000;
pub const PRICE_SCALE: u128 = 1_000_000;
pub const BPS: u128 = 10_000;
pub const FEE_BPS: u128 = 10;
pub const MAX_IMPACT_BPS: u128 = 190;
pub const ORACLE_DEV_BPS: u128 = 500;
pub const RESERVE_BPS: u128 = 1_000;
pub const MAX_LTV_BPS: u128 = 5_000;
pub const LIQ_BPS: u128 = 6_000;
pub const BONUS_BPS: u128 = 500;
pub const CLOSE_BPS: u128 = 5_000;
pub const APR_BPS: u128 = 800;
pub const INDEX_SCALE: u128 = 1_000_000_000_000;
pub const SECONDS_PER_YEAR: u128 = 31_536_000;
pub const START_PRICE: u128 = 100_000_000;

#[derive(Debug, PartialEq, Eq)]
pub enum MathError {
    InvalidAmount,
    InsufficientFunds,
    InsufficientLiquidity,
    Slippage,
    StaleOracle,
    Health,
}

pub fn nav_quote(quote_cash: u128, quote_debt: u128) -> u128 {
    quote_cash.saturating_add(quote_debt)
}

pub fn min_cash(quote_cash: u128, quote_debt: u128) -> u128 {
    nav_quote(quote_cash, quote_debt).saturating_mul(RESERVE_BPS) / BPS
}

pub fn accrue_index(index: u128, last_accrual: i64, now: i64) -> u128 {
    let dt = (now.saturating_sub(last_accrual).max(0)) as u128;
    if dt == 0 {
        return index;
    }
    let growth = INDEX_SCALE.saturating_add(APR_BPS.saturating_mul(INDEX_SCALE).saturating_mul(dt) / (BPS * SECONDS_PER_YEAR));
    index.saturating_mul(growth) / INDEX_SCALE
}

pub fn debt_from_shares(shares: u128, index: u128) -> u128 {
    shares.saturating_mul(index) / INDEX_SCALE
}

pub fn shares_from_debt(amount: u128, index: u128) -> Result<u128, MathError> {
    if index == 0 {
        return Err(MathError::InvalidAmount);
    }
    Ok(amount.saturating_mul(INDEX_SCALE) / index)
}

pub fn deposit_shares(amount: u128, total_shares: u128, nav: u128) -> Result<u128, MathError> {
    if amount == 0 {
        return Err(MathError::InvalidAmount);
    }
    if total_shares == 0 || nav == 0 {
        return Ok(amount);
    }
    Ok(amount.saturating_mul(total_shares) / nav)
}

pub fn redeem_assets(shares: u128, total_shares: u128, nav: u128) -> Result<u128, MathError> {
    if shares == 0 || total_shares == 0 {
        return Err(MathError::InvalidAmount);
    }
    if shares > total_shares {
        return Err(MathError::InsufficientFunds);
    }
    Ok(shares.saturating_mul(nav) / total_shares)
}

pub fn impact_bps(amount_in: u128, cash: u128) -> Result<u128, MathError> {
    if cash == 0 {
        return Err(MathError::InsufficientLiquidity);
    }
    Ok((amount_in.saturating_mul(BPS) / cash).min(MAX_IMPACT_BPS))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SwapResult {
    pub out: u128,
    pub impact: u128,
    pub exec_price: u128,
    pub base_cash: u128,
    pub quote_cash: u128,
}

pub fn swap_out(
    buy_base: bool,
    amount_in: u128,
    price: u128,
    base_cash: u128,
    quote_cash: u128,
) -> Result<SwapResult, MathError> {
    if amount_in == 0 {
        return Err(MathError::InvalidAmount);
    }
    if price == 0 {
        return Err(MathError::StaleOracle);
    }
    let cash = if buy_base { quote_cash } else { base_cash };
    let impact = impact_bps(amount_in, cash)?;
    let gross = if buy_base {
        amount_in.saturating_mul(PRICE_SCALE) / price
    } else {
        amount_in.saturating_mul(price) / PRICE_SCALE
    };
    let out = gross.saturating_mul(BPS - FEE_BPS - impact) / BPS;
    if out == 0 {
        return Err(MathError::InsufficientLiquidity);
    }
    let inventory = if buy_base { base_cash } else { quote_cash };
    if out > inventory {
        return Err(MathError::InsufficientLiquidity);
    }
    let exec_price = if buy_base {
        amount_in.saturating_mul(PRICE_SCALE) / out
    } else {
        out.saturating_mul(PRICE_SCALE) / amount_in
    };
    let deviation = if exec_price > price { exec_price - price } else { price - exec_price };
    if deviation.saturating_mul(BPS) / price > ORACLE_DEV_BPS {
        return Err(MathError::Slippage);
    }
    let (next_base, next_quote) = if buy_base {
        (base_cash - out, quote_cash + amount_in)
    } else {
        (base_cash + amount_in, quote_cash - out)
    };
    Ok(SwapResult { out, impact, exec_price, base_cash: next_base, quote_cash: next_quote })
}

pub fn ltv_bps(debt: u128, collateral: u128, price: u128) -> u128 {
    if collateral == 0 || price == 0 {
        return if debt > 0 { BPS * 10 } else { 0 };
    }
    debt.saturating_mul(PRICE_SCALE).saturating_mul(BPS) / collateral.saturating_mul(price)
}

pub fn max_borrow(collateral: u128, price: u128, debt: u128) -> u128 {
    let capacity = collateral.saturating_mul(price).saturating_mul(MAX_LTV_BPS) / (PRICE_SCALE * BPS);
    capacity.saturating_sub(debt)
}

pub fn liquidation(debt: u128, collateral: u128, price: u128) -> Result<(u128, u128), MathError> {
    if ltv_bps(debt, collateral, price) < LIQ_BPS {
        return Err(MathError::Health);
    }
    let mut repay = debt.saturating_mul(CLOSE_BPS) / BPS;
    if repay == 0 {
        repay = debt;
    }
    repay = repay.min(debt);
    let seize = repay.saturating_mul(PRICE_SCALE).saturating_mul(BPS + BONUS_BPS) / (price * BPS);
    if seize > collateral {
        return Err(MathError::Health);
    }
    Ok((repay, seize))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn liquidation_vector() {
        let (repay, seize) = liquidation(4_000 * UNIT, 100 * UNIT, 60_000_000).unwrap();
        assert_eq!(repay, 2_000 * UNIT);
        assert_eq!(seize, 35 * UNIT);
    }

    #[test]
    fn year_interest() {
        let next = accrue_index(INDEX_SCALE, 0, SECONDS_PER_YEAR as i64);
        assert_eq!(next, INDEX_SCALE * 108 / 100);
    }

    #[test]
    fn zero_liquidity_rejected() {
        assert_eq!(
            swap_out(true, UNIT, START_PRICE, 0, 0).unwrap_err(),
            MathError::InsufficientLiquidity
        );
    }

    #[test]
    fn buy_and_sell_exact_in() {
        let buy = swap_out(true, 100 * UNIT, START_PRICE, 10_000 * UNIT, 1_000_000 * UNIT).unwrap();
        assert!(buy.out > 0);
        let sell = swap_out(false, buy.out, START_PRICE, buy.base_cash, buy.quote_cash).unwrap();
        assert!(sell.out < 100 * UNIT);
    }

    #[test]
    fn ltv_reject_above_fifty() {
        assert_eq!(max_borrow(100 * UNIT, START_PRICE, 0), 5_000 * UNIT);
        assert!(ltv_bps(5_001 * UNIT, 100 * UNIT, START_PRICE) > MAX_LTV_BPS);
    }

    #[test]
    fn healthy_position_not_liquidated() {
        assert_eq!(
            liquidation(1_000 * UNIT, 100 * UNIT, START_PRICE).unwrap_err(),
            MathError::Health
        );
    }
}
