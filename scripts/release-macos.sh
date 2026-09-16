#!/usr/bin/env bash
# Local-only finalization: credentials stay in the maintainer's keychain.
set -euo pipefail
input="${1:?Usage: release-macos.sh built/YUME.app NEW-output-directory}"
output="${2:?Missing output directory}"
: "${MACOS_SIGNING_IDENTITY:?Set MACOS_SIGNING_IDENTITY to a Developer ID Application identity}"
: "${MACOS_NOTARY_PROFILE:?Set MACOS_NOTARY_PROFILE to a local notarytool keychain profile}"
test "$(uname -s)" = Darwin
test -d "$input/Contents"
test ! -e "$output" || { echo 'Output directory must be new; never overwrite a release' >&2; exit 1; }
mkdir -p "$output"
output=$(cd "$output" && pwd)
scripts=$(cd "$(dirname "$0")" && pwd)
app="$output/YUME.app"
ditto "$input" "$app"
bash "$scripts/prepare-macos-dependencies.sh" "$app" "${MACOS_RELEASE_CACHE:-$output/cache}"
# Sign inside-out. Never use --deep to sign, or give every helper JIT privileges.
while IFS= read -r -d '' binary; do
  file -b "$binary" | grep -q 'Mach-O' || continue
  args=(--force --sign "$MACOS_SIGNING_IDENTITY" --options runtime --timestamp)
  if [[ "$binary" = "$app/Contents/Resources/resources/opencode/opencode" ]]; then
    args+=(--entitlements "$scripts/macos/opencode-entitlements.plist")
  fi
  codesign "${args[@]}" "$binary"
done < <(find "$app/Contents" -type f -print0)
codesign --force --sign "$MACOS_SIGNING_IDENTITY" --options runtime --timestamp "$app"
bash "$scripts/verify-macos-app.sh" "$app" --before-notarization
ditto -c -k --sequesterRsrc --keepParent "$app" "$output/notarization.zip"
bash "$scripts/notarize-macos.sh" "$output/notarization.zip" "$app" "$output/logs/app"
# Test after notarization: first execution must not wait for approval of code
# we have not submitted yet. Bound execution so a hung helper fails the gate.
perl -e 'alarm shift; exec @ARGV or die $!;' 120 "$app/Contents/Resources/resources/opencode/opencode" --version
perl -e 'alarm shift; exec @ARGV or die $!;' 120 "$app/Contents/Resources/resources/ncmdump/ncmdump" --help
bash "$scripts/package-macos.sh" "$app" "$output/downloads"
echo "Verified downloads: $output/downloads"
echo "Installable app: $app"
