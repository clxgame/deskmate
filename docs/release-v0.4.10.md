# YUME v0.4.10

## Changes

- Reworked conversation history into a compact, grouped list with always-visible search, collapsible filters, accessible row actions, and real recent-message previews. Existing conversation identities, archive/delete protections, and bounded pagination remain intact.
- Added DeepSeek account balance and local daily token/request summaries to AI settings. Usage is counted from completed assistant messages and kept separate from the existing gateway weekly summary.
- Made provider switching explicit in AI settings: verified models belong to the active provider, and changing a provider's API binding clears stale model selection before verification or CC Switch deployment.

## Verification

- TypeScript production/test type checks and Vite production build passed.
- Focused frontend tests for conversation history, AI usage, provider selection, and CC Switch passed with Bun 1.3.14; the macOS release/update guard suite passed.
- Rust history tests (84) and AI usage tests (12) passed. The full Rust library suite had seven failures in unchanged Windows CC Switch fixtures and a worklog tool text-contract fixture on macOS; those are not part of this release's changed modules.
- macOS Developer ID signing, notarization, updater verification, runtime checks, and final release publication are still required after the CI draft is built. The unsigned CI app is not a public download.
