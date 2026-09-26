# Unified conversation history contract

Contract version: 1. Implementation scope: isolated `codex/yume-opencode-v048` checkout. Native content remains owned by OpenCode; original legacy `history.json` remains the authority for legacy text. The catalog stores organization and cached summaries only, never native messages, parts, attachment data, or tool output.

## Identity and discovery

- Native identity is `(sidecarId, canonical directory, sessionId)`. The persisted catalog lives inside one application data namespace. `managed-local-v1` identifies that namespace's managed OpenCode data store; it survives process, port, credential and application restarts. Another data store must receive a different identity. Never use a process ID or a transient port as identity.
- `CatalogIdentity::key()` returns an opaque, unambiguous, length-prefixed native tuple. Legacy keys are exactly `legacy:<historyId>`. Never deduplicate, mutate or load a global history row by bare native ID alone.
- Normalize known existing directories using filesystem canonicalization at the host boundary to resolve symbolic links. The pure model then normalizes Windows drive/UNC casing, slash direction, verbatim prefix, trailing separators and dot segments. POSIX path case remains meaningful. Relative paths, control characters and parent traversal above a root are rejected. A cached canonical directory stays usable as an identity while its volume or sidecar is unavailable.
- Discovery is restricted to explicitly known canonical directories. Follow all native pages through exhaustion. `DiscoveryCandidate` rejects malformed identity, deleted session, child session and unknown directory with an explicit `ExclusionReason`; a native child is never promoted into a top-level organizer row.
- A legacy native projection coalesces only when its native association establishes the complete tuple. Preserve agent ownership/recovery metadata during coalescing. A matching bare ID in another project or data store is insufficient evidence. Ambiguous old text stays legacy; never infer missing native tool context.
- Failed discovery preserves cached summaries with `stale` or `unavailable` availability. Absence from a failed or partial page is not deletion. Tombstones exclude rows from both ordinary and archived lists regardless of remote retries.

## Metadata and wire shape

`CatalogEntry` serializes with camelCase field names:

| Field | Contract |
| --- | --- |
| identity | `{kind:"native",sidecarId,directory,sessionId}` or `{kind:"legacy",historyId}` |
| title / userTitle | Cached source title / nullable explicit user title. `displayTitle` selects userTitle first. Automatic first-turn titles must not overwrite a user title. |
| source | `light_chat`, `workbench`, `legacy`; creation provenance, not content authority |
| created / updated | Millisecond timestamps; updated is source activity, organization mutations must not fabricate a new conversation turn |
| pinned / archived | YUME organization state; archive is reversible |
| availability | `available`, `stale`, `unavailable` |
| ownership | `unowned`, `workbench`, `agent`; never derive ownership from title or source alone |
| runtime | `idle`, `running`, `unknown`; absence of runtime evidence is unknown |
| tombstone | null or `{requestedAt,remoteDeleted}`; durable suppression precedes remote deletion |

Host rows add `key`, `displayTitle` and computed `capabilities`. The metadata catalog schema is additive and independently versioned by its persistence owner. Never ask an older OpenCode binary to downgrade the native database.

## Capability matrix

The following assumes a row without a tombstone. The host recomputes runtime/ownership before a mutation; renderer capability flags are presentation guidance, not authorization.

| Row | Read light chat | Open workbench | Send light chat | Rename | Pin | Archive/restore | Delete |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Native available, unowned, idle | yes | yes | yes unless archived | native API | local | local | confirmed + live guard |
| Native available, workbench/agent owned, idle | yes | yes | no | native API | local | local | confirmed + live guard |
| Native running or runtime unknown | yes when available | yes when available | no | when available | local | local | no |
| Native stale/unavailable | cached summary only | no | no | no | local | local | no |
| Legacy text | yes | no | no | local override | local | local | confirmed + idle guard |
| Tombstoned | no | no | no | no | no | no | retry handled internally |

**Approved archive adjustment (2026-09-24):** user-visible archive is local to YUME and does not call the native archive API or alter the workbench sidebar. Native archive timestamps are not silently imported as YUME user archive. This supersedes the original plan's native PATCH requirement. Archive remains available offline and is separate from agent recovery snapshots called “archive”.

`HistoryCapabilities` contains boolean `open`, `openWorkbench`, `send`, `rename`, `pin`, `archive`, `delete`, plus nullable `readOnlyReason`. Reasons are `deleted`, `native_unavailable`, `legacy_text_only`, `archived`, `active_task`, `runtime_unknown`, `workbench_owned`, `agent_owned`. A row may be readable while unable to send. Native cached summaries do not imply an offline transcript cache.

Permanent delete requires explicit UI confirmation, a fresh host safety check, an atomically durable tombstone, then remote deletion. Failed remote deletion leaves the tombstone available for retry. Tombstoned native projections and delayed agent snapshots must never recreate a visible row. Original legacy bytes remain intact for rollback; the organizer hides deleted legacy rows through metadata.

## Synthetic fixtures and verification boundary

`catalog_model_tests.rs` constructs 1,007 synthetic native summaries, a cross-project bare-ID collision, another sidecar identity, legacy text identity, ownership/runtime combinations, unavailable/archived/deleted states, and excluded malformed/child/out-of-scope records. It drives a real JSON write/reopen/read using an isolated temporary directory and removes that directory after success. A 100-row synthetic paging traversal verifies 1,008 distinct identities; the discovery adapter must independently prove network pagination and failure handling.

The standalone harness under `.omo/evidence/unified-conversation-history/contract-harness/` runs the same production module before host registration. These tests establish identity/metadata behavior, not real sidecar or WebView2 acceptance. Backend, migration and UI tasks retain those separate verification gates. No production history is read by these tests.

## Local product replies and scoped recovery (implementation clarification)

New deterministic local replies use `HistoryMessage.localOnly = true`. Their auxiliary record remains in the existing `history.json`, with `localLink` carrying the complete native identity and a `local_<SHA-256(composite key)>` storage ID. It contains only local product text, never a copy of native messages, parts or tool state. Import excludes these auxiliary records from organizer rows. Reads merge tagged local text by the exact composite identity; writes cannot replace another project's note or the original untagged legacy record. The renderer labels these local replies explicitly. No native API replay or direct native database mutation is used.

Old untagged compatibility text is only exposed as a text-only/read-only fallback after the scoped native transcript is verified empty. Once actual native content exists, it remains the native authority; untagged projection text is never replayed as native messages. Original legacy data remains stored for rollback.

Native agent details are serialized alongside catalog load results, selected using native directory plus session ID. A legacy recovery detail requires its trusted origin run. Bare-ID collision cannot borrow another project's recovery status, scheduled provenance, transcript or catalog organization.

## On-demand organizer previews (2026-09-27)

`history_catalog_previews(keys)` accepts at most 12 complete catalog keys from the chat or workbench window. The host resolves each key through the catalog, rejects tombstones and unavailable native records, and verifies the requested native session still belongs to its catalog directory before reading content. It returns a result per key with `ready`, `empty`, or `unavailable` status. A ready result carries at most 160 Unicode characters of the latest user/assistant text, its role and message time, and a `localOnly` marker for a linked local reply. System, reasoning, tool and binary parts are excluded. The catalog and `history.json` never receive native preview text.

The pinned OpenCode sidecar's recent-message endpoint is read in pages of eight, at most two pages per preview. Each response is capped at 8 MiB and two seconds; session verification is capped at 64 KiB and two seconds. A bounded tail with no text is **not** evidence that the native transcript is empty, so it cannot activate old untagged compatibility text. The host allows at most two concurrent preview reads and stops starting new reads four seconds into a batch, leaving up to six seconds for the final read. It keeps at most 200 cached entries / 512 KiB, with 30-second success and five-second failure lifetimes. Native refresh, local reply saves and deletion invalidate affected cached results. The renderer requests only visible rows and a small scroll margin and discards responses from an obsolete list generation.
