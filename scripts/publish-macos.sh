#!/usr/bin/env bash
# Attach only locally verified assets to an existing, unpublished draft.
set -euo pipefail
directory="${1:?Usage: publish-macos.sh downloads-directory version [owner/repository]}"
version="${2:?Missing version}"
repo="${3:-clxgame/deskmate}"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || exit 1
[[ "$repo" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || exit 1
scripts=$(cd "$(dirname "$0")" && pwd)
bash "$scripts/verify-macos-downloads.sh" "$directory" "$version"
test "$(gh release view "v$version" --repo "$repo" --json isDraft --jq .isDraft)" = true || {
  echo 'Refusing to modify a published release' >&2; exit 1;
}
# No glob, no --clobber: never leak caches/logs/unsigned inputs or replace assets.
gh release upload "v$version" --repo "$repo" \
  "$directory/YUME_${version}_aarch64.dmg" \
  "$directory/YUME_${version}_aarch64.app.zip" \
  "$directory/SHA256SUMS-macos.txt"
echo 'Verified macOS assets uploaded to draft. Check Windows assets before publishing.'
