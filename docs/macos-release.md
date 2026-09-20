# macOS release gate

## Why macOS said the app was damaged

The old release workflow ran `tauri build --no-sign`, then uploaded DMG/ZIP
files after only checking their container integrity. The executable retained a
linker ad-hoc signature, without a sealed application bundle, Developer ID or
notarization. On the affected 0.3.21 app, `codesign --verify --deep --strict`
reported `code has no resources but signature indicates they must be present`.
A successful `hdiutil verify` / `unzip -t` does **not** prove Gatekeeper will
allow the application to launch. The earlier manual repair of 0.3.16 did not
change that workflow, so later builds repeated the failure.

A second portability defect was the bundled ncmdump executable linking to
`/opt/homebrew/opt/taglib/lib/libtag.2.dylib`. That library normally does not
exist on a user's Mac. The release script now builds pinned TagLib 2.1.1 from
verified source, bundles it with its source/licenses, and changes ncmdump to
load it inside the app. Undeclared external dependencies fail validation.

## Two-phase release (Apple Silicon)

Developer ID private keys and notary credentials stay in the maintainer's local
keychain. Windows updater signing is independent of Apple signing. Never put
Apple private keys, `.p12` files, passwords or notary credentials in the repo,
Actions artifacts or release attachments.

1. Push the version tag. CI creates a **draft**, builds Windows downloads and
   stores `macos-unsigned-<commit>` as an **Actions artifact**, not a Release
   asset. A green CI run means the candidate built; macOS is not release-ready.
2. On the signing Mac, check out the matching tag (plus any reviewed release
   tooling fixes), download that run's artifact, and extract
   `YUME.unsigned.app.zip` with `ditto -x -k` into a new directory. Do not run
   or distribute this unsigned candidate. Alternatively build the matching
   source locally with `bun run tauri build --no-sign --bundles app --ci`.
3. Have a valid Developer ID Application identity with its private key in
   Keychain, Xcode command-line tools with the license accepted, and a
   `notarytool` keychain profile. Configure that profile interactively with
   `xcrun notarytool store-credentials <profile>`; never send passwords in chat
   or store them in scripts. The identity SHA-1 from
   `security find-identity -v -p codesigning` is an identifier, not a secret.
4. Finalize with an output directory that does not exist. If the updater private
   key is available locally, export it through `TAURI_SIGNING_PRIVATE_KEY` or
   `TAURI_SIGNING_PRIVATE_KEY_PATH`. If it is kept only as the repository
   secret, explicitly select the draft-only Actions handoff:

   ```bash
   export MACOS_SIGNING_IDENTITY='<Developer ID Application identity SHA-1>'
   export MACOS_NOTARY_PROFILE='<local keychain profile name>'
   export MACOS_UPDATER_SIGNING=github-actions # omit when signing locally
   bash scripts/release-macos.sh /path/to/YUME.app /path/to/new-release-output
   ```

   The input is never modified. This builds the portable dependency, signs all
   Mach-O code inside-out with timestamps and hardened runtime (JIT only for
   OpenCode), notarizes/staples the App, smoke-tests both helpers, then builds,
   signs, notarizes and staples the DMG. The ZIP contains the stapled App.
   Both downloads are re-opened to check their App signatures, dependencies,
   notarization, versions and identical contents. Hashes cover final bytes.
   Public packaging rejects unsigned, ad-hoc, tampered or unnotarized Apps;
   there is no unsigned override. Only arm64 packages are currently supported.

   Downloads of TagLib and CMake are pinned by version and SHA-256. Optional
   `MACOS_RELEASE_CACHE=/path/to/cache` reuses verified source/tool archives;
   it never reuses an unverified prebuilt library. Requires access to GitHub
   and Apple's timestamp/notarization services. Notarization can take minutes.

5. With a local updater key, upload the finalized downloads to the existing
   draft. Packaging creates `YUME_<version>_aarch64.app.tar.gz` plus its Tauri
   updater signature. The updater private key must match the public key embedded
   in `tauri.conf.json` and must never be copied into the repository or output.

   ```bash
   bash scripts/publish-macos.sh /path/to/new-release-output/downloads 0.3.21
   ```

   This rechecks all downloads, reuses only byte-identical assets already present
   in the draft, and merges `darwin-aarch64` into the Windows-generated
   `latest.json`. A conflict or published release is rejected. Do not upload the
   output root, caches, notarization input, logs, unsigned candidate or a DMG made
   directly by `tauri build --no-sign`.

   When `MACOS_UPDATER_SIGNING=github-actions` was used, upload only the three
   locally reverified Apple payloads, then manually dispatch the pinned
   `finalize macOS release` workflow for the same version:

   ```bash
   bash scripts/upload-macos-payloads.sh /path/to/new-release-output/downloads 0.4.4
   gh workflow run finalize-macos-release.yml -f version=0.4.4
   ```

   That workflow refuses published releases, checks out the matching tag, uses
   the existing repository updater secret to sign only the tarball, preserves
   the Windows entries while merging `darwin-aarch64`, and uploads the final
   signature and checksums. It never receives the Apple identity or notary
   credentials. Download all five Mac assets afterward and run
   `verify-macos-downloads.sh` locally before publishing.
6. Check the Windows installer/signature and merged `latest.json`, then perform
   [runtime checks](macos-runtime-checks.md). Before publishing, prove an older
   auto-update-capable, signed and notarized Mac build completes one click from
   check through download, installation and restart in an isolated location.

## Failures and recovery

Failed commands stop the pipeline and prevent the publish script from accepting
the downloads. Inspect `logs/app` or `downloads/logs/dmg` for Apple's submission
ID and diagnostics; a timeout is not an approval. Use `xcrun notarytool info`
or `log` with the same local profile to investigate. Retry into a new output
directory after fixing the cause. Do not strip quarantine, disable Gatekeeper,
force certificate trust, or distribute partially generated files as a workaround.

Run regression checks on macOS with `bun test scripts/macos-release.test.ts`.
For an existing download directory, independently run:

```bash
bash scripts/verify-macos-downloads.sh /path/to/downloads 0.3.21
```

The App in the output root is an installable copy of the verified App in the
downloads. Keep the previous installed version recoverable until the new one
passes local checks. App data and user settings are not part of this procedure.
