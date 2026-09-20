#!/usr/bin/env bash
set -euo pipefail
directory="${1:?Usage: verify-macos-downloads.sh downloads-directory version}"
version="${2:?Missing version}"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || exit 1
directory=$(cd "$directory" && pwd)
scripts=$(cd "$(dirname "$0")" && pwd)
dmg="$directory/YUME_${version}_aarch64.dmg"
zip="$directory/YUME_${version}_aarch64.app.zip"
updater="$directory/YUME_${version}_aarch64.app.tar.gz"
signature="$updater.sig"
test -s "$dmg" && test -s "$zip" && test -s "$updater" && test -s "$signature"
# Do not accept a manifest that omits an artifact or includes unrelated paths.
expected=$(cd "$directory" && shasum -a 256 \
  "$(basename "$dmg")" "$(basename "$zip")" "$(basename "$updater")" "$(basename "$signature")")
test "$(< "$directory/SHA256SUMS-macos.txt")" = "$expected"
bash "$scripts/verify-macos-payloads.sh" "$directory" "$version"
echo "All finalized macOS downloads passed checksum and payload checks"
