use borsh::{BorshDeserialize, BorshSerialize};

#[derive(Clone, Debug, BorshSerialize, BorshDeserialize)]
pub enum Instruction {
    Initialize,
    OracleUpdate { price: u128 },
    FaucetMint { amount: u64, base: u8 },
    Supply { amount: u64, base: u8 },
    Withdraw { amount: u64, base: u8 },
    Swap { amount_in: u64, buy_base: u8, min_out: u64, nonce: u64, deadline: i64 },
    AddCollateral { amount: u64 },
    RemoveCollateral { amount: u64 },
    Borrow { amount: u64 },
    Repay { amount: u64 },
    Liquidate,
    Accrue,
    Pause { paused: u8 },
}
