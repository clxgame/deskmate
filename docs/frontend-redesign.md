# Frontend redesign handoff — 0.4.5

The settings redesign from `yume-redesign-files.zip` is integrated into the
existing Tauri settings entry point on `codex/frontend-redesign`.

## Integrated changes

- Four shared palettes with translucent surfaces, card shadows and focus tokens.
- Bento cards for general preferences, themes, shortcuts, pet controls, nickname
  and About; updated switches, sliders, theme tiles and title bar.
- Integration fixes: localized badges in all four languages, accessible labels
  for language/nickname controls, inherited title-bar drag targeting, runtime
  version display, themed paw icons, accurate palette swatches, wrapping About
  metadata, and removal of the duplicate pet-controls card border.
- App version is 0.4.5 in all four release manifests.

The supplied `src/App.tsx` is an independent browser demo with no entry point in
this desktop project. It was not added to the shipping app. The existing Bun
test preload already matches the supplied `bunfig.toml`.

## Validation

- Full production/test TypeScript check passed.
- 263 tests passed across 33 files: settings, macOS release guards and bundled
  persona boundaries. Release checks used the installed Command Line Tools SDK.
- Browser preview at the default 720 × 520 settings size checked all four
  themes, English labels, General/Desktop pet/Shortcuts/About navigation,
  Ctrl+5 navigation and a visible keyboard focus ring. The preview used isolated
  mock desktop services and did not write the user's settings.
- Production frontend and native arm64 macOS builds succeeded. Existing bundle
  size and Rust unused-code warnings remain.

CSS `backdrop-filter` does not configure native macOS Vibrancy or Windows Mica.
Native desktop blur, window dragging and hide/reopen still require an installed
app runtime check; browser checks do not establish those behaviors.

Local installers are prepared with the repository's Developer ID signing and
Apple notarization workflow. This branch does not publish an update or change
the stable release feed.
