#!/usr/bin/env bash
set -euo pipefail
export HOME="${HOME:-/home/rando}"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
cd /mnt/d/work/meme/rillvane
echo "attempting official airdrop..."
solana airdrop 2 || solana airdrop 1 || true
echo "pre-mine balance=$(solana balance || true)"
# 4 SOL is enough for a small program deploy plus mint/vault rent.
/home/rando/.cargo/bin/devnet-pow mine --target-lamports 4000000000 -k /mnt/d/work/meme/rillvane/ops/keys/deployer.json -u https://api.devnet.solana.com
echo "post-mine balance=$(solana balance || true)"
