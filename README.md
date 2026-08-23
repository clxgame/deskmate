# deskmate

Desktop pet application built with Tauri, React, TypeScript, and Bun.

OpenCode is pinned as a project dependency and bundled into release builds.
Users of the packaged app do not need to install OpenCode separately.

## Development

Install dependencies:

```powershell
bun install
```

Run the desktop app in development:

```powershell
bun run tauri dev
```

The Tauri dev/build hooks run `bun run prepare:sidecar`, which copies the
platform-specific OpenCode binary installed from the lockfile into the app
resources. The generated binary is intentionally ignored by Git.

Build the frontend only:

```powershell
bun run build
```

Build the signed Windows installer and updater artifacts:

```powershell
bun run tauri build
```

Build an unsigned local macOS app and DMG:

```bash
bun run tauri build --no-sign
```

The macOS build enables Tauri's private transparency API for the frameless pet
window, so it is intended for direct distribution rather than the Mac App Store.

## Releases and updater

The public updater repository is `clxgame/deskmate`. The app checks GitHub Releases in that repository for signed Windows updater artifacts.

Release prerequisites:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

Keep signing keys in the local environment or GitHub Actions secrets only. Never commit or publish the private signing key, password, tokens, or `.env` files.

Before tagging, keep these versions identical:

- `package.json`
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`

Check the release version locally:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\check-version.ps1 -TagName v0.1.1
```

Local signed build:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = "<private key>"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "<password>"
powershell -ExecutionPolicy Bypass -File scripts\release.ps1 -Tag v0.1.1
```

Local draft publish for already-built artifacts:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\publish.ps1 -Tag v0.1.1
```

The GitHub Actions release workflow runs on `v*` tags. It checks the tag against the app version, builds the signed Windows NSIS installer, uploads updater signatures and `latest.json`, and creates a draft GitHub Release first. Inspect the draft assets before publishing the release.

For a public release, bump the app version, push a matching tag, publish the draft GitHub Release with the installer, signature, and `latest.json`, then verify a real installed older build can update to the new release from `clxgame/deskmate`.
