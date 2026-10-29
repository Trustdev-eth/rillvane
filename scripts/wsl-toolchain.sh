#!/usr/bin/env bash
set -euo pipefail
export HOME="${HOME:-/home/rando}"
# Keep Windows PATH out of bash so parentheses in "Program Files (x86)" cannot break scripts.
export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
if [[ -f "$HOME/.cargo/env" ]]; then
  # shellcheck disable=SC1091
  source "$HOME/.cargo/env"
fi
echo "solana=$(command -v solana || true)"
echo "sbf=$(command -v cargo-build-sbf || true)"
echo "spl=$(command -v spl-token || true)"
echo "rustc=$(command -v rustc || true)"
if command -v solana >/dev/null; then
  solana --version
  solana config get
  echo "address=$(solana address || true)"
  echo "balance=$(solana balance || true)"
fi
if command -v cargo-build-sbf >/dev/null; then
  cargo-build-sbf --version
fi
ls -la "$HOME/.local/share/solana/install/active_release/bin" 2>/dev/null | head -n 40 || true
ls -la "$HOME/.cargo/bin" 2>/dev/null | head -n 40 || true
