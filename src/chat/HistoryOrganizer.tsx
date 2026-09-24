import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { CatalogQuery, ConversationSource, UnifiedHistoryRow } from "../lib/unifiedHistory";
import { historyDateBounds } from "../lib/unifiedHistory";
import { historyCopy } from "./historyOrganizerCopy";
import { useHistoryOrganizer } from "./useHistoryOrganizer";
import { HistoryOrganizerRow } from "./HistoryOrganizerRow";
import "./historyOrganizer.css";

interface HistoryOrganizerProps {
  readonly onOpen: (row: UnifiedHistoryRow) => void | Promise<void>;
  readonly onClose: () => void;
  readonly onChanged?: (key: string) => Promise<void>;
  readonly onNewChat?: () => void;
  readonly onDeleted?: (row: UnifiedHistoryRow, forgetMemories: boolean) => Promise<void>;
  readonly language?: string;
}
const PAGE_SIZE = 50;
const initialFilters = { search: "", tab: "active", directory: "", source: "", from: "", to: "", offset: 0 } as const;
type Filters = { search: string; tab: "active" | "pinned" | "archived"; directory: string; source: ConversationSource | ""; from: string; to: string; offset: number };

export function HistoryOrganizer({ onOpen, onClose, onNewChat, onDeleted, onChanged, language = "zh-CN" }: HistoryOrganizerProps) {
  const copy = historyCopy(language);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [searchInput, setSearchInput] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const searchId = useId();
  const sourceId = useId();
  const projectId = useId();
  const fromId = useId();
  const toId = useId();
  const invalidDates = !!(filters.from && filters.to && filters.from > filters.to);
  const query = useMemo<CatalogQuery>(() => ({
    search: filters.search, ...(filters.source ? { source: filters.source } : {}),
    ...(filters.directory ? { directory: filters.directory } : {}),
    archived: filters.tab === "archived", ...(filters.tab === "pinned" ? { pinned: true } : {}),
    ...historyDateBounds(filters.from, filters.to), offset: filters.offset, limit: PAGE_SIZE,
  }), [filters]);
  const state = useHistoryOrganizer(query, copy, onDeleted, onChanged);
  useEffect(() => {
    const timer = window.setTimeout(() => setFilters(current => current.search === searchInput ? current : { ...current, search: searchInput, offset: 0 }), 180);
    return () => window.clearTimeout(timer);
  }, [searchInput]);
  useEffect(() => {
    const previous = document.activeElement;
    root.current?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  const updateFilters = (value: Partial<Filters>) => setFilters(current => ({ ...current, ...value, offset: 0 }));
  const clear = () => { setSearchInput(""); setFilters(initialFilters); };
  const open = (row: UnifiedHistoryRow) => {
    state.setError("");
    void Promise.resolve().then(() => onOpen(row)).catch(() => state.setError(copy.openFailed));
  };
  const filtered = !!(filters.search || filters.directory || filters.source || filters.from || filters.to);
  const items = state.page?.items ?? [];
  const total = state.page?.total ?? 0;
  return <div ref={root} className="history-organizer" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
    onKeyDown={event => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      if (event.key !== "Tab") return;
      const focusable = root.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled)");
      const first = focusable?.[0];
      const last = focusable?.[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === root.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
    <header className="history-organizer-header">
      <h2 id={titleId}>{copy.title}</h2>
      {onNewChat && <button onClick={onNewChat}>{copy.newChat}</button>}
      <button disabled={state.loading} onClick={() => { void state.refresh(true); }}>{copy.refresh}</button>
      <button onClick={onClose}>{copy.close}</button>
    </header>
    <div className="history-organizer-filters">
      <label htmlFor={searchId}>{copy.search}</label>
      <input id={searchId} type="search" value={searchInput} placeholder={copy.search} aria-describedby={`${searchId}-note`}
        onChange={event => setSearchInput(event.target.value)} />
      <p id={`${searchId}-note`} className="history-organizer-note">{copy.searchNote}</p>
      <nav className="history-organizer-tabs" aria-label={copy.title}>
        {(["active", "pinned", "archived"] as const).map(tab => <button key={tab} aria-pressed={filters.tab === tab} onClick={() => updateFilters({ tab })}>{copy[tab]}</button>)}
      </nav>
      {filters.tab === "archived" && <p className="history-organizer-note">{copy.archiveNote}</p>}
      <div className="history-organizer-filter-grid">
        <label htmlFor={projectId}>{copy.project}<select id={projectId} value={filters.directory} onChange={event => updateFilters({ directory: event.target.value })}>
          <option value="">{copy.allProjects}</option>
          {(state.page?.directories ?? []).map(directory => <option key={directory} value={directory}>{directory}</option>)}
        </select></label>
        <label htmlFor={sourceId}>{copy.source}<select id={sourceId} value={filters.source} onChange={event => {
          const source = event.target.value;
          if (source === "" || source === "light_chat" || source === "workbench" || source === "legacy") updateFilters({ source });
        }}>
          <option value="">{copy.allSources}</option>
          {(["light_chat", "workbench", "legacy"] as const).map(source => <option key={source} value={source}>{copy[source]}</option>)}
        </select></label>
        <label htmlFor={fromId}>{copy.from}<input id={fromId} type="date" value={filters.from} max={filters.to || undefined} onChange={event => updateFilters({ from: event.target.value })} /></label>
        <label htmlFor={toId}>{copy.to}<input id={toId} type="date" value={filters.to} min={filters.from || undefined} onChange={event => updateFilters({ to: event.target.value })} /></label>
      </div>
      {filtered && <button className="history-organizer-clear" onClick={clear}>{copy.clear}</button>}
    </div>
    {invalidDates && <p className="history-organizer-error" role="alert">{copy.invalidDates}</p>}
    {state.page?.offline && <p className="history-organizer-warning history-organizer-status" role="status">{copy.offline}</p>}
    {state.error && <div className="history-organizer-error" role="alert">{state.error} <button disabled={state.loading} onClick={() => { void state.refresh(true); }}>{copy.retry}</button></div>}
    {!!state.page?.errors.length && !state.error && <p className="history-organizer-warning history-organizer-status" role="status">{state.page.errors.join(" · ")}</p>}
    <div className="history-organizer-results" aria-busy={state.loading}>
      {state.loading && <p className="history-organizer-status" role="status">{copy.loading}</p>}
      <ul className="history-organizer-list">
        {items.map(row => <HistoryOrganizerRow key={row.key} row={row} copy={copy} language={language} busy={state.busyKey !== null}
          onOpen={open} onMutate={state.mutate} />)}
      </ul>
      {!state.loading && !items.length && <p className="history-organizer-empty">{state.page?.offline ? copy.offlineEmpty : filtered ? copy.noResults : copy.empty}</p>}
    </div>
    <footer className="history-organizer-pagination">
      <span aria-live="polite">{total} {copy.conversations} · {copy.page} {Math.floor(filters.offset / PAGE_SIZE) + 1} {copy.of} {Math.max(1, Math.ceil(total / PAGE_SIZE))}</span>
      <button disabled={state.loading || filters.offset === 0} onClick={() => setFilters(current => ({ ...current, offset: Math.max(0, current.offset - PAGE_SIZE) }))}>{copy.previous}</button>
      <button disabled={state.loading || !state.page?.hasMore} onClick={() => setFilters(current => ({ ...current, offset: current.offset + PAGE_SIZE }))}>{copy.next}</button>
    </footer>
  </div>;
}




