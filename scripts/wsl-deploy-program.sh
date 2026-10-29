#!/usr/bin/env bash
set -euo pipefail
export HOME="${HOME:-/home/rando}"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:/usr/bin:/bin"
ROOT=/mnt/d/work/meme/rillvane
KEYS="$ROOT/ops/keys"
SO="$ROOT/programs/rillvane/target/deploy/rillvane.so"
PROGRAM=2GZypcHMjRrfrjimxkB5G4wcisj9MFZpns9gSSZbfrt4
solana config set --url https://api.devnet.solana.com --keypair "$KEYS/deployer.json" >/dev/null
echo "balance=$(solana balance)"
if solana program show "$PROGRAM" >/dev/null 2>&1; then
  echo "event=program.already_deployed"
  solana program show "$PROGRAM"
  exit 0
fi
if [[ ! -f "$SO" ]]; then
  echo "missing $SO" >&2
  exit 1
fi
solana program deploy "$SO" \
  --program-id "$KEYS/program.json" \
  --upgrade-authority "$KEYS/upgrade.json" \
  --keypair "$KEYS/deployer.json" \
  --url https://api.devnet.solana.com
echo "event=program.deployed"
solana program show "$PROGRAM"
