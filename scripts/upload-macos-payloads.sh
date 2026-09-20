#!/usr/bin/env bash
# Upload locally Developer-ID-signed and notarized payloads to an unpublished draft.
set -euo pipefail
directory="${1:?Usage: upload-macos-payloads.sh downloads-directory version [owner/repository]}"
version="${2:?Missing version}"
repo="${3:-clxgame/deskmate}"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || exit 1
[[ "$repo" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || exit 1
scripts=$(cd "$(dirname "$0")" && pwd)
bash "$scripts/verify-macos-payloads.sh" "$directory" "$version"
test "$(gh release view "v$version" --repo "$repo" --json isDraft --jq .isDraft)" = true || {
  echo 'Refusing to modify a published release' >&2; exit 1;
}
assets=(
  "$directory/YUME_${version}_aarch64.dmg"
  "$directory/YUME_${version}_aarch64.app.zip"
  "$directory/YUME_${version}_aarch64.app.tar.gz"
)
for asset in "${assets[@]}"; do
  name=$(basename "$asset")
  local_digest="sha256:$(shasum -a 256 "$asset" | awk '{print $1}')"
  remote_digest=$(gh release view "v$version" --repo "$repo" --json assets \
    --jq ".assets[] | select(.name == \"$name\") | .digest // empty")
  if [[ -n "$remote_digest" ]]; then
    test "$remote_digest" = "$local_digest" || { echo "Conflicting draft asset: $name" >&2; exit 1; }
  else
    gh release upload "v$version" --repo "$repo" "$asset"
  fi
done
echo 'Verified macOS payloads uploaded to draft; run the macOS updater finalizer before publishing.'
