# YUME

YUME is a desktop pet application built with Tauri, React, TypeScript, and Bun.

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

The Tauri dev/build hooks run `bun run prepare:sidecar`, which fetches the
binary build inputs into the app resources. These artifacts are intentionally
ignored by Git:

- **OpenCode sidecar** — copied from the version pinned in the lockfile.
- **ncmdump** — downloaded from its pinned upstream release
  ([taurusxin/ncmdump](https://github.com/taurusxin/ncmdump), MIT).

Each download is verified against a pinned SHA-256, so a swapped or truncated
artifact fails the build instead of shipping.

## Persona packs

Only the built-in 「AI 替身」pack (小著, ~375 KB) ships inside the app, so the
installer stays small. Everything else is a **persona pack**: a `.dmpack`
archive the user imports from 设置 → 角色 → 导入角色包, and can remove again.

Build a pack from the assets in `public/personas`:

```powershell
bun scripts/pack-personas.ts aki 1.0.0 aki-1.0.0.dmpack changli jinxi
# omit the persona ids to pack every directory under public/personas
```

Imported packs are unpacked to `<appData>/packs/<packId>/` and read through the
asset protocol, whose scope is restricted to that directory. Only personas a
pack actually shipped are offered in the selector, so a pack built with a subset
of its manifest cannot leave the pet without a model.

To fetch the original 3D assets for packing, a maintainer needs read access to
the private `clxgame/deskmate-assets` repository:

```powershell
$env:DESKMATE_ASSETS_TOKEN = "<token with read access>"
bun run fetch:persona-assets
```

This is a maintainer-only step; building and running the app does not need it.

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

## Memory

The companion can remember things about you. Memory is a local, inspectable
feature, not a hidden extension of chat history.

### What is remembered

Only what you save, or what you approve. Pick **记住这件事** on any message and
you get an inline receipt with a one-click undo. Nothing about a conversation is
stored just because it happened.

Memories have two scopes:

- **Shared** — how you want to be addressed, stable preferences, boundaries,
  routines, goals, and dated events. Every persona sees these.
- **Persona-only** — shared moments and relationship notes. Only the persona
  that created them can see or use them; switching personas never leaks them.

A changed stable fact replaces the old value rather than piling up, and the
previous value stays visible under **显示已替换和已过期** so you can see what
changed.

### What is refused

Credentials are rejected outright and never stored, exported, logged, or sent to
a model: passwords, API keys, tokens, private keys, recovery codes, payment-card
numbers, and government identifiers.

Private categories (health, finance, address, identity documents, intimate
relationships, confidential work) are never saved automatically. They require an
explicit confirmation that states where the data will live.

The companion will not store conclusions it inferred about you — personality
labels, diagnoses, political or religious identity — unless you state the fact
yourself and ask for it to be remembered.

### Where it lives

The legacy `deskmate-memory.db` file remains in the app data directory, next to `settings.json`, so existing YUME installations keep their memories:

```
%APPDATA%\com.deskmate.desktop\deskmate-memory.db
```

The file is **not encrypted**; it relies on your operating system's file
permissions, like the existing chat history. Forgetting a memory is a hard
delete: the content, its provenance, and its search index are removed, and the
write-ahead log is flushed so nothing lingers. Only a content-free audit record
("a memory was forgotten at this time") remains.

### What is sent to the AI

When a memory is relevant to what you are saying, it is included in the request
to whichever AI gateway you configured in Settings → AI. At most 8 memories and
1,200 characters are sent per message, always inside a clearly delimited
untrusted-data block that the model is told is factual background and not
instructions.

Turn off **允许 AI 使用记忆** in Settings → 记忆 to stop sending memories
entirely. Local memory management keeps working.

### Managing it

Settings → **记忆** lists everything with its type, scope, date, and the reason
it exists. From there you can search, edit, forget a single memory, export
everything to JSON, clear one persona, or clear all memory. Deleting a
conversation also offers to delete the memories that came only from it, on by
default.

If the database cannot be opened, memory is disabled for that run and the pet
and chat keep working normally.

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
