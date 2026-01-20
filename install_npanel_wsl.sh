#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -f "$SCRIPT_DIR/install_npanel.sh" ]]; then
  exec bash "$SCRIPT_DIR/install_npanel.sh" "$@"
fi

if command -v curl >/dev/null 2>&1; then
  tmp="/tmp/npanel-installer.$$.sh"
  curl -fsSL "https://raw.githubusercontent.com/omenyx/npanel/main/install_npanel.sh" -o "$tmp"
  chmod +x "$tmp" || true
  exec bash "$tmp" "$@"
fi

echo "[ERROR] curl is required to download the latest installer" >&2
exit 1

