#!/usr/bin/env bash
# ncmdump v1.5.1 links Homebrew TagLib 2.1.1. Bundle a pinned, portable build.
set -euo pipefail
app="${1:?Usage: prepare-macos-dependencies.sh YUME.app cache-directory}"
cache="${2:?Usage: prepare-macos-dependencies.sh YUME.app cache-directory}"
test "$(uname -s)" = Darwin
helper="$app/Contents/Resources/resources/ncmdump/ncmdump"
test -f "$helper"
mkdir -p "$cache"
cache=$(cd "$cache" && pwd)
fetch() {
  local url="$1" path="$2" hash="$3"
  if [[ ! -f "$path" ]]; then
    curl --fail --location --retry 3 --proto '=https' --proto-redir '=https' "$url" -o "$path.part"
    mv "$path.part" "$path"
  fi
  echo "$hash  $path" | shasum -a 256 --check
}
fetch https://github.com/taglib/taglib/releases/download/v2.1.1/taglib-2.1.1.tar.gz \
  "$cache/taglib-2.1.1.tar.gz" 3716d31f7c83cbf17b67c8cf44dd82b2a2f17e6780472287a16823e70305ddba
fetch https://github.com/Kitware/CMake/releases/download/v3.31.10/cmake-3.31.10-macos-universal.tar.gz \
  "$cache/cmake-3.31.10-macos-universal.tar.gz" be9f3faeeaf7921cc2d77cea711dd5e6f72c63af2810cacd9205b3ce8d1593c9
# Extract on every run so an edited cache cannot substitute different source.
work=$(mktemp -d "$cache/build.XXXXXX")
trap 'rm -rf "$work"' EXIT
tar -xzf "$cache/taglib-2.1.1.tar.gz" -C "$work"
tar -xzf "$cache/cmake-3.31.10-macos-universal.tar.gz" -C "$work"
cmake="$work/cmake-3.31.10-macos-universal/CMake.app/Contents/bin/cmake"
"$cmake" -S "$work/taglib-2.1.1" -B "$work/taglib-build" \
  -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=ON -DBUILD_TESTING=OFF \
  -DBUILD_BINDINGS=OFF -DCMAKE_OSX_ARCHITECTURES=arm64 \
  -DCMAKE_OSX_DEPLOYMENT_TARGET=11.0 -DCMAKE_INSTALL_NAME_DIR=@rpath \
  '-DCMAKE_IGNORE_PREFIX_PATH=/opt/homebrew;/usr/local'
"$cmake" --build "$work/taglib-build" --parallel 4
mkdir -p "$app/Contents/Frameworks" "$app/Contents/Resources/licenses/taglib"
cp "$work/taglib-build/taglib/libtag.2.1.1.dylib" "$app/Contents/Frameworks/libtag.2.dylib"
xcrun install_name_tool -change /opt/homebrew/opt/taglib/lib/libtag.2.dylib \
  @loader_path/../../../Frameworks/libtag.2.dylib "$helper"
license_dir="$app/Contents/Resources/licenses/taglib"
cp "$work/taglib-2.1.1/COPYING.MPL" "$license_dir/"
cp "$work/taglib-2.1.1/3rdparty/utfcpp/LICENSE" "$license_dir/utfcpp-LICENSE"
cp "$cache/taglib-2.1.1.tar.gz" "$license_dir/"
scripts=$(cd "$(dirname "$0")" && pwd)
cp "$scripts/macos/taglib-NOTICE.txt" "$license_dir/NOTICE.txt"
bash "$scripts/verify-macos-dependencies.sh" "$app"
