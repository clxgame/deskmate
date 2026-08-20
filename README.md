# deskmate

Desktop pet application built with Tauri, React, TypeScript, and Bun.

## Development

Install dependencies:

```powershell
bun install
```

Run the desktop app in development:

```powershell
bun run tauri dev
```

Build the frontend only:

```powershell
bun run build
```

Build the signed Windows installer and updater artifacts:

```powershell
bun run tauri build
```

## Releases and updater

The public updater repository is `clxgame/deskmate`. The app checks GitHub Releases in that repository for signed Windows updater artifacts.

Release prerequisites:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, if the private key is encrypted

Keep signing keys in the local environment or GitHub Actions secrets only. Never commit or publish the private signing key, password, tokens, or `.env` files.

For a public release, bump the app version, build signed artifacts, publish a GitHub Release with the installer, signature, and `latest.json`, then verify a real installed older build can update to the new release from `clxgame/deskmate`.
