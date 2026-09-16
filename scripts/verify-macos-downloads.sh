#!/usr/bin/env bash
set -euo pipefail
directory="${1:?Usage: verify-macos-downloads.sh downloads-directory version}"
version="${2:?Missing version}"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || exit 1
directory=$(cd "$directory" && pwd)
scripts=$(cd "$(dirname "$0")" && pwd)
dmg="$directory/YUME_${version}_aarch64.dmg"
zip="$directory/YUME_${version}_aarch64.app.zip"
test -s "$dmg" && test -s "$zip"
# Do not accept a manifest that omits an artifact or includes unrelated paths.
expected=$(cd "$directory" && shasum -a 256 "$(basename "$dmg")" "$(basename "$zip")")
test "$(< "$directory/SHA256SUMS-macos.txt")" = "$expected"
codesign --verify --strict --verbose=2 "$dmg"
xcrun stapler validate "$dmg"
spctl --assess --type open --context context:primary-signature --verbose=4 "$dmg"
hdiutil verify "$dmg"
work=$(mktemp -d "${TMPDIR:-/tmp}/yume-verify-downloads.XXXXXX")
mounted=false
cleanup() {
  if [[ "$mounted" = true ]]; then
    hdiutil detach "$work/mount" || return
  fi
  rm -rf "$work"
}
trap cleanup EXIT
ditto -x -k "$zip" "$work/zip"
bash "$scripts/verify-macos-app.sh" "$work/zip/YUME.app"
test "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$work/zip/YUME.app/Contents/Info.plist")" = "$version"
mkdir "$work/mount"
hdiutil attach "$dmg" -readonly -nobrowse -mountpoint "$work/mount"
mounted=true
bash "$scripts/verify-macos-app.sh" "$work/mount/YUME.app"
test "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$work/mount/YUME.app/Contents/Info.plist")" = "$version"
# DMG and ZIP must deliver identical app resources and stapled signature bytes.
diff -qr "$work/zip/YUME.app" "$work/mount/YUME.app"
echo "Both downloads passed signature, notarization, dependency and round-trip checks"
