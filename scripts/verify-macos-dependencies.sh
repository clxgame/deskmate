#!/usr/bin/env bash
# Fail closed on undeclared, machine-local, or missing Mach-O dependencies.
set -euo pipefail
app="${1:?Usage: verify-macos-dependencies.sh YUME.app}"
app=$(cd "$app" && pwd -P)
count=0
while IFS= read -r -d '' binary; do
  file -b "$binary" | grep -q 'Mach-O' || continue
  count=$((count + 1))
  test "$(lipo -archs "$binary")" = arm64 || {
    echo "Expected arm64 code: $binary" >&2; exit 1;
  }
  while IFS= read -r dependency; do
    case "$dependency" in
      /System/Library/*|/usr/lib/*) continue ;;
      @loader_path/*) resolved="$(dirname "$binary")/${dependency#@loader_path/}" ;;
      # @rpath / @executable_path need the loading process's context. Do not
      # guess that a Resources helper is launched from Contents/MacOS.
      *) echo "Non-portable dependency: $binary -> $dependency" >&2; exit 1 ;;
    esac
    test -f "$resolved" || { echo "Missing dependency: $resolved" >&2; exit 1; }
    resolved=$(perl -MCwd=abs_path -e 'print abs_path($ARGV[0])' "$resolved")
    case "$resolved" in
      "$app"/*) ;;
      *) echo "Dependency escapes app: $resolved" >&2; exit 1 ;;
    esac
  done < <(otool -l "$binary" | awk '
    $1 == "cmd" { load = ($2 ~ /^LC_(LOAD_DYLIB|LOAD_WEAK_DYLIB|REEXPORT_DYLIB|LOAD_UPWARD_DYLIB)$/) }
    load && $1 == "name" { sub(/^ *name /, ""); sub(/ \(offset.*$/, ""); print; load = 0 }
  ')
done < <(find "$app/Contents" -type f -print0)
test "$count" -gt 0 || { echo 'No Mach-O code in app' >&2; exit 1; }
echo "Verified dependencies of $count Mach-O files"
