#!/usr/bin/env bash
# Package an already-built native app without Finder/AppleScript automation.
set -euo pipefail

app_path="${1:?Usage: package-macos.sh path/to/YUME.app output-directory}"
output_dir="${2:?Usage: package-macos.sh path/to/YUME.app output-directory}"
test "$(uname -s)" = Darwin
test -d "$app_path/Contents"
version=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app_path/Contents/Info.plist")
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Invalid app version: $version"; exit 1; }
test "$(lipo -archs "$app_path/Contents/MacOS/yume")" = arm64

mkdir -p "$output_dir"
output_dir=$(cd "$output_dir" && pwd)
dmg_name="YUME_${version}_aarch64.dmg"
zip_name="YUME_${version}_aarch64.app.zip"
# Do not accidentally package over an existing local download.
test ! -e "$output_dir/$dmg_name"
test ! -e "$output_dir/$zip_name"

stage_dir=$(mktemp -d "${TMPDIR:-/tmp}/yume-macos-package.XXXXXX")
trap 'rm -rf "$stage_dir"' EXIT
ditto "$app_path" "$stage_dir/YUME.app"
ln -s /Applications "$stage_dir/Applications"
size_kib=$(du -sk "$stage_dir" | awk '{print $1}')
size_mib=$((size_kib / 1024 + 128))
(( size_mib >= 512 )) || size_mib=512
hdiutil create -volname YUME -srcfolder "$stage_dir" -size "${size_mib}m" -format UDZO "$output_dir/$dmg_name"
hdiutil verify "$output_dir/$dmg_name"
ditto -c -k --sequesterRsrc --keepParent "$app_path" "$output_dir/$zip_name"
unzip -tq "$output_dir/$zip_name"
(cd "$output_dir" && shasum -a 256 "$dmg_name" "$zip_name" > SHA256SUMS-macos.txt)
