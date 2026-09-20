#!/usr/bin/env bash
# Package ONLY a Developer ID signed, notarized native app.
set -euo pipefail

app_path="${1:?Usage: package-macos.sh path/to/YUME.app output-directory}"
output_dir="${2:?Usage: package-macos.sh path/to/YUME.app output-directory}"
test "$(uname -s)" = Darwin
test -d "$app_path/Contents"
scripts=$(cd "$(dirname "$0")" && pwd)
# Validate before creating any artifacts. There is deliberately no unsigned bypass.
bash "$scripts/verify-macos-app.sh" "$app_path"
: "${MACOS_SIGNING_IDENTITY:?A local Developer ID Application identity is required}"
: "${MACOS_NOTARY_PROFILE:?A local notarytool keychain profile is required}"
signing_mode=local
if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" && -z "${TAURI_SIGNING_PRIVATE_KEY_PATH:-}" ]]; then
  signing_mode="${MACOS_UPDATER_SIGNING:-}"
fi
if [[ "$signing_mode" != local && "$signing_mode" != github-actions ]]; then
  echo 'Set a Tauri updater private key, or explicitly set MACOS_UPDATER_SIGNING=github-actions' >&2
  exit 1
fi
version=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app_path/Contents/Info.plist")
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Invalid app version: $version"; exit 1; }
test "$(lipo -archs "$app_path/Contents/MacOS/yume")" = arm64

mkdir -p "$output_dir"
output_dir=$(cd "$output_dir" && pwd)
dmg_name="YUME_${version}_aarch64.dmg"
zip_name="YUME_${version}_aarch64.app.zip"
updater_name="YUME_${version}_aarch64.app.tar.gz"
# Do not accidentally package over an existing local download.
test ! -e "$output_dir/$dmg_name"
test ! -e "$output_dir/$zip_name"
test ! -e "$output_dir/$updater_name"
test ! -e "$output_dir/$updater_name.sig"
test ! -e "$output_dir/SHA256SUMS-macos.txt"

stage_dir=$(mktemp -d "${TMPDIR:-/tmp}/yume-macos-package.XXXXXX")
trap 'rm -rf "$stage_dir"' EXIT
ditto "$app_path" "$stage_dir/YUME.app"
ln -s /Applications "$stage_dir/Applications"
size_kib=$(du -sk "$stage_dir" | awk '{print $1}')
size_mib=$((size_kib / 1024 + 128))
(( size_mib >= 512 )) || size_mib=512
hdiutil create -volname YUME -srcfolder "$stage_dir" -size "${size_mib}m" -format UDZO "$output_dir/$dmg_name"
hdiutil verify "$output_dir/$dmg_name"
codesign --force --sign "$MACOS_SIGNING_IDENTITY" --timestamp "$output_dir/$dmg_name"
bash "$scripts/notarize-macos.sh" "$output_dir/$dmg_name" "$output_dir/$dmg_name" "$output_dir/logs/dmg"
codesign --verify --strict --verbose=2 "$output_dir/$dmg_name"
spctl --assess --type open --context context:primary-signature --verbose=4 "$output_dir/$dmg_name"
ditto -c -k --sequesterRsrc --keepParent "$app_path" "$output_dir/$zip_name"
unzip -tq "$output_dir/$zip_name"
updater_stage="$stage_dir/updater"
mkdir "$updater_stage"
ditto "$app_path" "$updater_stage/YUME.app"
(cd "$updater_stage" && COPYFILE_DISABLE=1 /usr/bin/tar -czf "$output_dir/$updater_name" YUME.app)
if [[ "$signing_mode" = local ]]; then
  repo_root=$(cd "$scripts/.." && pwd)
  "$repo_root/node_modules/.bin/tauri" signer sign \
    -p "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" "$output_dir/$updater_name"
  test -s "$output_dir/$updater_name.sig"
  # Hash only finalized bytes, after stapling and updater signing.
  (cd "$output_dir" && shasum -a 256 \
    "$dmg_name" "$zip_name" "$updater_name" "$updater_name.sig" > SHA256SUMS-macos.txt)
  bash "$scripts/verify-macos-downloads.sh" "$output_dir" "$version"
else
  # Only the draft-only CI finalizer may add the updater signature and checksum.
  bash "$scripts/verify-macos-payloads.sh" "$output_dir" "$version"
  echo 'Updater payload staged for GitHub Actions signing; this directory is not release-complete yet.'
fi
