#!/usr/bin/env bash
set -euo pipefail
directory="${1:?Usage: verify-macos-payloads.sh downloads-directory version}"
version="${2:?Missing version}"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || exit 1
directory=$(cd "$directory" && pwd)
scripts=$(cd "$(dirname "$0")" && pwd)
dmg="$directory/YUME_${version}_aarch64.dmg"
zip="$directory/YUME_${version}_aarch64.app.zip"
updater="$directory/YUME_${version}_aarch64.app.tar.gz"
test -s "$dmg" && test -s "$zip" && test -s "$updater"
codesign --verify --strict --verbose=2 "$dmg"
xcrun stapler validate "$dmg"
spctl --assess --type open --context context:primary-signature --verbose=4 "$dmg"
hdiutil verify "$dmg"
work=$(mktemp -d "${TMPDIR:-/tmp}/yume-verify-payloads.XXXXXX")
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
mkdir "$work/updater"
COPYFILE_DISABLE=1 /usr/bin/tar -xzf "$updater" -C "$work/updater"
test "$(find "$work/updater" -mindepth 1 -maxdepth 1 -print | wc -l | tr -d ' ')" = 1
test -d "$work/updater/YUME.app/Contents"
bash "$scripts/verify-macos-app.sh" "$work/updater/YUME.app"
test "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$work/updater/YUME.app/Contents/Info.plist")" = "$version"
mkdir "$work/mount"
hdiutil attach "$dmg" -readonly -nobrowse -mountpoint "$work/mount"
mounted=true
bash "$scripts/verify-macos-app.sh" "$work/mount/YUME.app"
test "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$work/mount/YUME.app/Contents/Info.plist")" = "$version"
# Every delivery format must contain the exact same signed and notarized App.
diff -qr "$work/zip/YUME.app" "$work/mount/YUME.app"
diff -qr "$work/zip/YUME.app" "$work/updater/YUME.app"
echo "All macOS payloads passed signature, notarization, dependency and round-trip checks"
