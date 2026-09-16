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
4. Finalize with an output directory that does not exist:

   ```bash
   export MACOS_SIGNING_IDENTITY='<Developer ID Application identity SHA-1>'
   export MACOS_NOTARY_PROFILE='<local keychain profile name>'
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

5. Upload **only** the three finalized download files to the existing draft:

   ```bash
   bash scripts/publish-macos.sh /path/to/new-release-output/downloads 0.3.21
   ```

   This rechecks the downloads and refuses published releases or overwriting
   existing assets. Do not upload the output root, caches, notarization input,
   logs, unsigned candidate or a DMG made directly by `tauri build --no-sign`.
6. Check Windows installer/signature/`latest.json`, install the signed Mac App,
   and perform [runtime checks](macos-runtime-checks.md). Only then publish the
   draft. Check an older installed Mac can find and download the new installer.

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
