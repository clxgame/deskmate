#!/usr/bin/env bash
set -euo pipefail
input="${1:?Usage: notarize-macos.sh upload-file staple-target log-directory}"
target="${2:?Missing staple target}"
logs="${3:?Missing log directory}"
: "${MACOS_NOTARY_PROFILE:?Set MACOS_NOTARY_PROFILE to a local notarytool keychain profile}"
mkdir -p "$logs"
# Save the ID before waiting, so a timeout/interruption remains diagnosable.
echo "Submitting for notarization: $input"
xcrun notarytool submit "$input" --keychain-profile "$MACOS_NOTARY_PROFILE" \
  --output-format json > "$logs/submission.json"
id=$(plutil -extract id raw -o - "$logs/submission.json")
echo "Waiting for Apple notarization: $id"
if ! xcrun notarytool wait "$id" --keychain-profile "$MACOS_NOTARY_PROFILE" \
  --timeout 30m --output-format json > "$logs/status.json"; then
  xcrun notarytool log "$id" --keychain-profile "$MACOS_NOTARY_PROFILE" "$logs/notary-log.json" || true
  echo "Notarization did not complete successfully: $id (see $logs)" >&2
  exit 1
fi
status=$(plutil -extract status raw -o - "$logs/status.json")
xcrun notarytool log "$id" --keychain-profile "$MACOS_NOTARY_PROFILE" "$logs/notary-log.json"
test "$status" = Accepted || { echo "Notarization rejected: $logs" >&2; exit 1; }
xcrun stapler staple "$target"
xcrun stapler validate "$target"
