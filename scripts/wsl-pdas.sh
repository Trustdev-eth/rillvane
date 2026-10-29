#!/usr/bin/env bash
set -euo pipefail
export HOME="${HOME:-/home/rando}"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
cd /mnt/d/work/meme/rillvane/programs/rillvane
cargo test --offline protocol_pdas -- --nocapture --exact
echo "so=$(ls -l target/deploy/rillvane.so)"
echo "program=$(solana-keygen pubkey /mnt/d/work/meme/rillvane/ops/keys/program.json)"
echo "deployer=$(solana-keygen pubkey /mnt/d/work/meme/rillvane/ops/keys/deployer.json)"
echo "upgrade=$(solana-keygen pubkey /mnt/d/work/meme/rillvane/ops/keys/upgrade.json)"
echo "oracle=$(solana-keygen pubkey /mnt/d/work/meme/rillvane/ops/keys/oracle.json)"
echo "faucet=$(solana-keygen pubkey /mnt/d/work/meme/rillvane/ops/keys/faucet.json)"
echo "keeper=$(solana-keygen pubkey /mnt/d/work/meme/rillvane/ops/keys/keeper.json)"
