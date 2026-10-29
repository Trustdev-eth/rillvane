//! Rillvane protocol program.
//!
//! Instructions: initialize, oracle_update, faucet_mint, supply, withdraw, swap,
//! add_collateral, remove_collateral, borrow, repay, liquidate, accrue, pause.

pub mod error;
pub mod instruction;
pub mod math;
pub mod processor;
pub mod state;

use solana_program::{
    account_info::AccountInfo, entrypoint, entrypoint::ProgramResult, pubkey::Pubkey,
};

solana_program::declare_id!("2GZypcHMjRrfrjimxkB5G4wcisj9MFZpns9gSSZbfrt4");

#[cfg(not(feature = "no-entrypoint"))]
entrypoint!(process_instruction);

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    processor::process(program_id, accounts, instruction_data)
}
