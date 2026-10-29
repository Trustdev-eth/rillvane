#!/usr/bin/env bash
set -euo pipefail
export HOME="${HOME:-/home/rando}"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
if [[ -f "$HOME/.cargo/env" ]]; then
  # shellcheck disable=SC1091
  source "$HOME/.cargo/env"
fi
cd /mnt/d/work/meme/rillvane/programs/rillvane
echo "host tests..."
cargo test --offline 2>/dev/null || cargo test
echo "sbf build..."
cargo-build-sbf
echo "artifacts:"
ls -la target/deploy || true
ls -la ../../target/deploy || true
find . -name 'rillvane.so' -o -name 'rillvane.json' | head
