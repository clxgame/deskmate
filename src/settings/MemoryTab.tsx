import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  asMemoryError,
  memoryClear,
  memoryExport,
  memoryForget,
  memoryList,
  memoryUpdate,
  onMemoryChanged,
  type MemoryErrorCode,
  type MemoryRecord,
  type MemoryStatus,
} from "../lib/memory";
import type { Dict } from "../lib/i18n";
import { ALL_PERSONAS, personaLabel } from "../pet/personaCatalog";

/**
 * Memory Center: the user's view of everything the companion remembers.
 *
 * Every list is re-fetched from Rust rather than cached locally, so the pet,
 * chat, and settings windows cannot drift apart. `deskmate://memory-changed`
 * only tells us that something changed.
 */

/** Which memories to show. */
type ScopeFilter = "all" | "global" | "persona";

interface MemoryTabProps {
  language: string;
  personaId: string;
  autoExtract: boolean;
  aiUse: boolean;
  onAutoExtractChange: (value: boolean) => void;
  onAiUseChange: (value: boolean) => void;
  t: Dict;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; records: MemoryRecord[] }
  | { kind: "failed"; code: MemoryErrorCode };

/** A destructive action waiting for confirmation. */
type PendingDestructive =
  | { kind: "forget"; id: string; content: string }
  | { kind: "clear-persona"; personaId: string }
  | { kind: "clear-all" };

const STATUS_FILTERS: Record<"active" | "history", MemoryStatus[]> = {
  active: ["active"],
  history: ["active", "superseded", "expired"],
};

export function MemoryTab({
  language,
  personaId,
  autoExtract,
  aiUse,
  onAutoExtractChange,
  onAiUseChange,
  t,
}: MemoryTabProps) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [search, setSearch] = useState("");
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
  const [showHistory, setShowHistory] = useState(false);
  const [editing, setEditing] = useState<{ id: string; content: string } | null>(
    null,
  );
  const [pending, setPending] = useState<PendingDestructive | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Latest request wins, so a slow response cannot overwrite a newer list. */
  const requestSequence = useRef(0);

  const load = useCallback(async () => {
    const sequence = ++requestSequence.current;
    try {
      const records = await memoryList({
        personaId: scopeFilter === "global" ? null : personaId,
        scope: scopeFilter === "all" ? null : scopeFilter,
        statuses: showHistory ? STATUS_FILTERS.history : STATUS_FILTERS.active,
        search: search.trim() || null,
      });
      if (sequence !== requestSequence.current) return;
      setState({ kind: "ready", records });
    } catch (error) {
      if (sequence !== requestSequence.current) return;
      setState({ kind: "failed", code: asMemoryError(error).code });
    }
  }, [personaId, scopeFilter, search, showHistory]);

  useEffect(() => {
    void load();
  }, [load]);

  // Another window changed something: re-fetch rather than guess.
  useEffect(() => {
    const subscription = onMemoryChanged(() => {
      void load();
    });
    return () => {
      void subscription.then((unlisten) => unlisten());
    };
  }, [load]);

  // Memories outlive pack installs, so name personas from every known pack
  // rather than only the installed ones — otherwise a memory saved while a pack
  // was present would show a raw id after the pack is removed.
  const personaNames = useMemo(
    () =>
      new Map(
        ALL_PERSONAS.map((persona) => [
          persona.id,
          personaLabel(persona, language),
        ]),
      ),
    [language],
  );


  const reportFailure = useCallback(
    (error: unknown) => {
      const { code } = asMemoryError(error);
      switch (code) {
        case "CONFLICT":
          setNotice(t.memoryConflictNotice);
          break;
        case "SECRET_REJECTED":
          setNotice(t.memorySecretRejected);
          break;
        case "SENSITIVE_CONFIRMATION_REQUIRED":
          setNotice(t.memoryCenterSensitiveBlocked);
          break;
        case "MEMORY_DISABLED":
        case "STORAGE_UNAVAILABLE":
        case "MIGRATION_FAILED":
          setNotice(t.memoryDisabledNotice);
          break;
        default:
          setNotice(t.memorySaveFailed);
      }
    },
    [t],
  );

  const saveEdit = useCallback(
    async (record: MemoryRecord, content: string) => {
      try {
        await memoryUpdate({
          id: record.id,
          content,
          expectedRevision: record.revision,
          // The Memory Center edits an already-stored memory; if the new text
          // is sensitive the user is already looking at their own data.
          sensitiveConfirmed: true,
        });
        setEditing(null);
        setNotice(null);
        await load();
      } catch (error) {
        reportFailure(error);
        // A conflict means someone else won: show their version.
        await load();
      }
    },
    [load, reportFailure],
  );

  const runDestructive = useCallback(async () => {
    if (!pending) return;
    try {
      if (pending.kind === "forget") {
        await memoryForget(pending.id);
        setNotice(t.memoryForgotten);
      } else if (pending.kind === "clear-persona") {
        const removed = await memoryClear({
          scope: "persona",
          personaId: pending.personaId,
        });
        setNotice(t.memoryClearedCount(removed));
      } else {
        const removed = await memoryClear({});
        setNotice(t.memoryClearedCount(removed));
      }
      setPending(null);
      await load();
    } catch (error) {
      setPending(null);
      reportFailure(error);
    }
  }, [load, pending, reportFailure, t]);

  const runExport = useCallback(async () => {
    try {
      const payload = await memoryExport();
      // A download keeps the export inside the webview's own sandbox instead
      // of needing filesystem permissions.
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `deskmate-memory-${payload.exportedAt.slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setNotice(t.memoryExported(payload.memories.length));
    } catch (error) {
      reportFailure(error);
    }
  }, [reportFailure, t]);

  return (
    <>
      <h2 className="set-panel-head">{t.tabMemory}</h2>
      <p className="set-note">{t.memoryPrivacyHint}</p>

      <div className="set-row">
        <span className="set-row-label">{t.memoryAutoExtract}</span>
        <div className="set-row-control">
          <label className="set-switch">
            <input
              type="checkbox"
              checked={autoExtract}
              aria-label={t.memoryAutoExtract}
              onChange={(event) => onAutoExtractChange(event.target.checked)}
            />
            <span className="set-switch-track" />
          </label>
        </div>
      </div>
      <p className="set-note">{t.memoryAutoExtractHint}</p>

      <div className="set-row">
        <span className="set-row-label">{t.memoryAiUse}</span>
        <div className="set-row-control">
          <label className="set-switch">
            <input
              type="checkbox"
              checked={aiUse}
              aria-label={t.memoryAiUse}
              onChange={(event) => onAiUseChange(event.target.checked)}
            />
            <span className="set-switch-track" />
          </label>
        </div>
      </div>
      <p className="set-note">{t.memoryAiUseHint}</p>

      <div className="set-memory-toolbar">
        <input
          className="set-input set-memory-search"
          type="search"
          value={search}
          placeholder={t.memorySearchPlaceholder}
          aria-label={t.memorySearchPlaceholder}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          className="set-select set-memory-scope"
          value={scopeFilter}
          aria-label={t.memoryScopeFilter}
          onChange={(event) => setScopeFilter(event.target.value as ScopeFilter)}
        >
          <option value="all">{t.memoryScopeAll}</option>
          <option value="global">{t.memoryScopeGlobal}</option>
          <option value="persona">
            {t.memoryScopeCurrentPersona(
              personaNames.get(personaId) ?? personaId,
            )}
          </option>
        </select>
        <label className="set-memory-history-toggle">
          <input
            type="checkbox"
            checked={showHistory}
            onChange={(event) => setShowHistory(event.target.checked)}
          />
          {t.memoryShowHistory}
        </label>
      </div>

      {notice && (
        <p className="set-memory-notice" role="status" aria-live="polite">
          {notice}
        </p>
      )}

      {state.kind === "loading" && <div className="set-loading">{t.loading}</div>}

      {state.kind === "failed" && (
        <p className="set-memory-error" role="alert">
          {state.code === "MEMORY_DISABLED"
            ? t.memoryDisabledNotice
            : t.memoryLoadFailed}
        </p>
      )}

      {state.kind === "ready" && state.records.length === 0 && (
        <p className="set-memory-empty">
          {search.trim() ? t.memoryNoMatches : t.memoryEmpty}
        </p>
      )}

      {state.kind === "ready" && state.records.length > 0 && (
        <ul className="set-memory-list">
          {state.records.map((record) => (
            <li
              key={record.id}
              className={`set-memory-item set-memory-item-${record.status}`}
            >
              {editing?.id === record.id ? (
                <div className="set-memory-edit">
                  <textarea
                    className="set-input set-memory-textarea"
                    value={editing.content}
                    aria-label={t.memoryEdit}
                    rows={3}
                    onChange={(event) =>
                      setEditing({ id: record.id, content: event.target.value })
                    }
                  />
                  <div className="set-memory-actions">
                    <button
                      type="button"
                      className="set-btn"
                      onClick={() => void saveEdit(record, editing.content)}
                    >
                      {t.memorySaveEdit}
                    </button>
                    <button
                      type="button"
                      className="set-btn"
                      onClick={() => setEditing(null)}
                    >
                      {t.memoryCancelEdit}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="set-memory-content">{record.content}</p>
                  <p className="set-memory-meta">
                    <span>{memoryTypeLabel(t, record.type)}</span>
                    <span>
                      {record.scope === "global"
                        ? t.memoryScopeGlobal
                        : (personaNames.get(record.personaId ?? "") ??
                          record.personaId)}
                    </span>
                    <span>{record.createdAt.slice(0, 10)}</span>
                    <span>{sourceLabel(t, record)}</span>
                    {record.status !== "active" && (
                      <span className="set-memory-status">
                        {record.status === "superseded"
                          ? t.memoryStatusSuperseded
                          : t.memoryStatusExpired}
                      </span>
                    )}
                  </p>
                  <div className="set-memory-actions">
                    <button
                      type="button"
                      className="set-btn"
                      onClick={() =>
                        setEditing({ id: record.id, content: record.content })
                      }
                    >
                      {t.memoryEdit}
                    </button>
                    <button
                      type="button"
                      className="set-btn set-btn-danger"
                      onClick={() =>
                        setPending({
                          kind: "forget",
                          id: record.id,
                          content: record.content,
                        })
                      }
                    >
                      {t.memoryForgetOne}
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="set-memory-bulk">
        <button type="button" className="set-btn" onClick={() => void runExport()}>
          {t.memoryExport}
        </button>
        <button
          type="button"
          className="set-btn set-btn-danger"
          onClick={() => setPending({ kind: "clear-persona", personaId })}
        >
          {t.memoryClearPersona(personaNames.get(personaId) ?? personaId)}
        </button>
        <button
          type="button"
          className="set-btn set-btn-danger"
          onClick={() => setPending({ kind: "clear-all" })}
        >
          {t.memoryClearAll}
        </button>
      </div>

      {pending && (
        <div className="set-memory-confirm" role="alertdialog" aria-modal="true">
          <p className="set-memory-confirm-body">
            {pending.kind === "forget"
              ? t.memoryConfirmForget(pending.content)
              : pending.kind === "clear-persona"
                ? t.memoryConfirmClearPersona(
                    personaNames.get(pending.personaId) ?? pending.personaId,
                  )
                : t.memoryConfirmClearAll}
          </p>
          <div className="set-memory-actions">
            <button
              type="button"
              className="set-btn set-btn-danger"
              onClick={() => void runDestructive()}
            >
              {t.memoryConfirmDelete}
            </button>
            <button
              type="button"
              className="set-btn"
              onClick={() => setPending(null)}
            >
              {t.memoryCancelEdit}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function memoryTypeLabel(t: Dict, type: MemoryRecord["type"]): string {
  switch (type) {
    case "identity":
      return t.memoryTypeIdentity;
    case "preference":
      return t.memoryTypePreference;
    case "boundary":
      return t.memoryTypeBoundary;
    case "routine":
      return t.memoryTypeRoutine;
    case "goal":
      return t.memoryTypeGoal;
    case "event":
      return t.memoryTypeEvent;
    case "shared_moment":
      return t.memoryTypeSharedMoment;
    case "mood":
      return t.memoryTypeMood;
  }
}

/** Why this memory exists, from its provenance. */
function sourceLabel(t: Dict, record: MemoryRecord): string {
  const kind = record.sources[0]?.sourceKind ?? record.sourceKind;
  switch (kind) {
    case "explicit":
      return t.memorySourceExplicit;
    case "extracted":
      return t.memorySourceExtracted;
    case "onboarding":
      return t.memorySourceOnboarding;
    case "follow_up":
      return t.memorySourceFollowUp;
  }
}

