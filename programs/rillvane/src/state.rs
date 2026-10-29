use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::pubkey::Pubkey;

pub const CONFIG_SEED: &[u8] = b"config";
pub const MARKET_SEED: &[u8] = b"market";
pub const ORACLE_SEED: &[u8] = b"oracle";
pub const USER_SEED: &[u8] = b"user";

pub const CONFIG_SPACE: usize = 256;
pub const MARKET_SPACE: usize = 512;
pub const ORACLE_SPACE: usize = 256;
pub const USER_SPACE: usize = 256;

#[derive(Clone, Debug, Default, BorshSerialize, BorshDeserialize)]
pub struct Config {
    pub version: u64,
    pub upgrade_authority: Pubkey,
    pub oracle_authority: Pubkey,
    pub faucet_authority: Pubkey,
    pub keeper: Pubkey,
    pub paused: u32,
    pub epoch: u64,
}

#[derive(Clone, Debug, Default, BorshSerialize, BorshDeserialize)]
pub struct Oracle {
    pub market: Pubkey,
    pub updater: Pubkey,
    pub price: u128,
    pub exponent: i32,
    pub publish_time: i64,
    pub slot: u64,
}

#[derive(Clone, Debug, Default, BorshSerialize, BorshDeserialize)]
pub struct Market {
    pub base_mint: Pubkey,
    pub quote_mint: Pubkey,
    pub base_vault: Pubkey,
    pub quote_vault: Pubkey,
    pub oracle: Pubkey,
    pub base_cash: u128,
    pub quote_cash: u128,
    pub quote_debt: u128,
    pub base_shares: u128,
    pub quote_shares: u128,
    pub debt_shares: u128,
    pub borrow_index: u128,
    pub last_accrual: i64,
    pub paused: u32,
}

#[derive(Clone, Debug, Default, BorshSerialize, BorshDeserialize)]
pub struct User {
    pub owner: Pubkey,
    pub market: Pubkey,
    pub base_shares: u128,
    pub quote_shares: u128,
    pub collateral: u128,
    pub debt_shares: u128,
    pub nonce: u64,
}
