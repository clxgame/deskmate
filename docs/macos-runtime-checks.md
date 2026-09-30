# macOS runtime checks

Build success alone does not establish that a transparent pet window is visible.
Run these checks against the packaged `YUME.app`, not only a browser preview.
For this Mac's toolchain and execution permissions, first follow the
[local release runbook](local-release-runbook.md).

## Automated regression checks

```sh
export DEVELOPER_DIR=/Library/Developer/CommandLineTools
bun run typecheck
bun run test:frontend
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib pet_
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib updater::
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

## Update footer behavior

Opening Settings starts a manifest check. Checks recur every 15 minutes while the
window remains open, on return to the window after at least one minute, and after
network recovery. A background check has a 30-second timeout and never downloads
or installs. Its timeout does not limit a user-triggered download. Late responses
for an old repository or an earlier check cannot replace current update progress.
The active operation displays progress, errors and retry; a Mac task waiting for
idle retains the cancel-wait action.

The dated UI validation is retained in the [historical footer record](archive/updater/conditional-update-footer.md).

## Update checks

Settings checks the shared `latest.json` feed in the background and shows
**下载更新** (Download update) only when a newer build is available for the current
platform. No-update and failed-background-check states keep only the local version.
A click starts the existing install-and-restart flow. Current Mac builds use the
signed `darwin-aarch64` tarball; the client downloads and verifies the
update, waits for running tasks to finish, replaces the App with a recoverable
backup, then requests restart. DMG/ZIP remain available for initial installation
and migration from old clients without the automatic installer.

Run the actual Mac installation regression tests:

```sh
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib \
  updater::macos::tests
```

There are currently five tests covering App path discovery, backup ownership,
privileged path arguments, archive layout and restoring the backup. Require a
nonzero test count. The old `live_public_mac_release_check` name does not exist;
an exact filter that runs zero tests is not a successful API verification.

For packaged-app verification:

1. Use an older auto-update-capable, Developer-ID-signed and notarized App in an
   isolated writable installation location and isolated data environment. Copying
   the App alone does not isolate its user data. Preserve the user's daily install.
2. Before publication, use a controlled QA update source. The nondefault
   `updater-qa` feature accepts a compile-time `YUME_UPDATER_QA_ENDPOINT` pointing
   to loopback HTTP. It is not a runtime environment override for a production
   binary. Test builds must retain the same signing/identity requirements for
   their A/B pair, and the update signature must match the test client's embedded
   public key. The following steps are the current acceptance gate; the
   [historical upgrade plan](archive/updater/macos-one-click-update-plan.md) retains
   earlier design and failure matrices.
   Keep the QA feature/configuration out of the public build. Production clients
   cannot discover a draft through the public latest feed.
3. Wait for **下载更新** to appear for the test update, then click it once.
   Observe download, verification, installation and
   restart without a second confirmation or browser/manual installer step.
   Check the actual running version afterward, persisted data, pet/settings
   windows and sidecars. Do not claim success merely because restart was requested.
4. While a task is running, verify that installation waits, then proceeds after
   the task ends; also verify cancel/retry behavior. Record permissions and
   failure/restore scenarios actually exercised, keeping the previous App recoverable.
5. Check from the target version: the footer retains the local version without
   an update button and does not download, install or restart. After publication, verify the public manifest points to the verified
   version; this network check does not replace the A→B runtime test.

Record automated tests, payload checks, public-feed checks and observed A→B
results separately. If an isolated signed/notarized A/B pair or test source is
unavailable, report the runtime upgrade check as unverified. Never substitute
mock tests or helper smoke tests for the real packaged-app result.
