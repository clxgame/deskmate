#!/usr/bin/env bash
set -euo pipefail
app="${1:?Usage: verify-macos-app.sh YUME.app [--before-notarization]}"
mode="${2:-}"
[[ -z "$mode" || "$mode" = --before-notarization ]] || exit 1
scripts=$(cd "$(dirname "$0")" && pwd)
codesign --verify --deep --strict --verbose=2 "$app"
details=$(codesign --display --verbose=4 "$app" 2>&1)
echo "$details" | grep -q '^Authority=Developer ID Application:' || {
  echo 'A Developer ID Application signature is required (not ad hoc)' >&2; exit 1;
}
team=$(echo "$details" | sed -n 's/^TeamIdentifier=//p')
test -n "$team" && test "$team" != not\ set
# --deep alone does not verify all executables stored under Resources.
while IFS= read -r -d '' binary; do
  file -b "$binary" | grep -q 'Mach-O' || continue
  codesign --verify --strict --verbose=2 "$binary"
  details=$(codesign --display --verbose=4 "$binary" 2>&1)
  echo "$details" | grep -q '^Authority=Developer ID Application:'
  echo "$details" | grep -Fqx "TeamIdentifier=$team"
  echo "$details" | grep -q '^Timestamp='
  echo "$details" | grep -q 'flags=.*runtime'
done < <(find "$app/Contents" -type f -print0)
bash "$scripts/verify-macos-dependencies.sh" "$app"
if [[ "$mode" != --before-notarization ]]; then
  xcrun stapler validate "$app"
  spctl --assess --type execute --verbose=4 "$app"
fi
