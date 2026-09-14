# macOS runtime checks

Build success alone does not establish that a transparent pet window is visible.
Run these checks against the packaged `YUME.app`, not only a browser preview.

## Automated regression checks

```sh
bun run typecheck
bun test
cargo test --manifest-path src-tauri/Cargo.toml --lib pet_
```

The native tests cover the reported Retina position `(3100, 1662)` at 170% pet
scale, valid positions on secondary displays with negative coordinates, display
removal, work-area changes, large pets, transparent GIF padding, manual recovery,
and settling without interfering with ordinary dragging. Some frontend tests
start a temporary server on `127.0.0.1`; allow local listening when running them.

## Packaged application checks

1. Back up `settings.json` in the app's data directory, then quit YUME. Preserve
   other settings and only seed a `petPosition` outside the current work area.
   Launch the app and confirm the selected character becomes visible within
   about two seconds after initialization, including at 170% scale. Confirm its corrected position
   is persisted, then quit and relaunch to check that it remains reachable.
2. Use the tray's **显示/隐藏桌宠** twice. The same character must reappear in the
   current work area. Then choose **找回桌宠**; it must show the pet on the primary
   display even if the pet was hidden or on another display.
3. Change the pet size near the right/bottom screen edges. After resizing settles,
   the drawing must remain reachable. Drag to another valid position and ensure
   that it is not periodically reset.
4. With a physical second display, move the pet there, unplug the display, and
   confirm recovery on the remaining display. Repeat while hidden and with
   different display scale factors. Reconnect it and verify that a valid position
   on either display is preserved. Mark this step unverified if no second display
   is available; geometry tests do not replace the hardware check.
5. Verify the DMG checksum with `hdiutil verify`, mount it read-only, and confirm
   it contains the updated app and an `Applications` shortcut.

Keep separate records for automated checks, observed application behavior, and
hardware scenarios that were not exercised. Do not change system display/security
settings just to make a build appear to pass.
