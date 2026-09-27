# YUME v0.4.11

## Changes

- Replaced the persistent workspace strip with a compact chat composer. Folder, attachment, model, and Send/Stop controls share one input area; task progress and approvals remain visible when needed.
- Added explicit per-conversation model selection, stored by the complete native history identity. The selected model reaches both ordinary OpenCode chat requests and folder Agent runs. A changed or unverified provider/model blocks the next send instead of silently switching models.
- Added recent explicit workspaces, safe folder transitions that preserve unsent drafts, model search, localized feedback, and compact task status in the conversation.

## Verification

- Frontend type checks and production build passed. Related chat, attachment, Agent history, approval, and settings tests passed in focused groups (64 and 42 tests).
- Rust Agent and history groups passed (91 and 86 tests). The full Rust library suite retained seven failures in Windows CC Switch and worklog fixtures; the full Bun source suite had cross-file mock and unrelated environment failures. Neither full suite is recorded as green.
- In an isolated 420 × 560 macOS QA app, a local controlled model service captured `qa-model-b` for both ordinary chat and folder Agent requests. Model selection restoration, folder switching, Agent Stop, and a visible rejectable approval were checked. The 720 × 760 layout was also inspected. The native app enforces a 420px minimum at startup, so the 360px CSS pressure case has no native screenshot.

macOS Developer ID signing, notarization, release asset checks, and final publication must pass the gates in [macos-release.md](macos-release.md). An unsigned CI candidate is not a public download.
