import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowClockwise";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { SlidersHorizontalIcon } from "@phosphor-icons/react/dist/csr/SlidersHorizontal";
import type { CatalogQuery, ConversationSource, UnifiedHistoryRow } from "../lib/unifiedHistory";
import { historyDateBounds } from "../lib/unifiedHistory";
import { AppIcon } from "../ui/AppIcon";
import { historyCopy } from "./historyOrganizerCopy";
import { groupedRows, projectLabels } from "./historyOrganizerPresentation";
import { useHistoryOrganizer } from "./useHistoryOrganizer";
import { useHistoryPreviews } from "./useHistoryPreviews";
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
const EMPTY_ROWS: readonly UnifiedHistoryRow[] = [];
const initialFilters = { search: "", tab: "active", pinned: false, directory: "", source: "", from: "", to: "", offset: 0 } as const;
type Filters = { search: string; tab: "active" | "archived"; pinned: boolean; directory: string; source: ConversationSource | ""; from: string; to: string; offset: number };
type FilterKey = "directory" | "source" | "from" | "to" | "pinned";

export function HistoryOrganizer({ onOpen, onClose, onNewChat, onDeleted, onChanged, language = "zh-CN" }: HistoryOrganizerProps) {
  const copy = historyCopy(language);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [searchInput, setSearchInput] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [menuKey, setMenuKey] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const searchId = useId();
  const filterId = useId();
  const sourceId = useId();
  const projectId = useId();
  const fromId = useId();
  const toId = useId();
  const [now, setNow] = useState(() => new Date());
  const invalidDates = !!(filters.from && filters.to && filters.from > filters.to);
  const query = useMemo<CatalogQuery>(() => ({
    search: filters.search, ...(filters.source ? { source: filters.source } : {}),
    ...(filters.directory ? { directory: filters.directory } : {}),
    archived: filters.tab === "archived", ...(filters.pinned ? { pinned: true } : {}),
    ...historyDateBounds(invalidDates ? "" : filters.from, invalidDates ? "" : filters.to),
    offset: filters.offset, limit: PAGE_SIZE,
  }), [filters, invalidDates]);
  const state = useHistoryOrganizer(query, copy, onDeleted, onChanged, !invalidDates);
  const items = state.page?.items ?? EMPTY_ROWS;
  const previews = useHistoryPreviews(items, results);
  const labels = useMemo(() => projectLabels(items, copy, state.page?.directories), [items, copy, state.page?.directories]);
  const groups = useMemo(() => groupedRows(items, now, copy), [items, now, copy]);
  const total = state.page?.total ?? 0;
  const advancedCount = Number(!!filters.directory) + Number(!!filters.source) + Number(!!filters.from) + Number(!!filters.to) + Number(filters.pinned);
  const filtered = !!(filters.search || advancedCount);

  useEffect(() => {
    const timer = window.setTimeout(() => setFilters(current => current.search === searchInput ? current : { ...current, search: searchInput, offset: 0 }), 180);
    return () => window.clearTimeout(timer);
  }, [searchInput]);
  useEffect(() => {
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    const timer = window.setTimeout(() => setNow(new Date()), midnight.getTime() - Date.now() + 1000);
    return () => window.clearTimeout(timer);
  }, [now]);
  useEffect(() => {
    const previous = document.activeElement;
    root.current?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    if (!state.loading && filters.offset > 0 && state.page && !state.page.items.length) {
      setFilters(current => ({ ...current, offset: Math.max(0, Math.floor((state.page!.total - 1) / PAGE_SIZE) * PAGE_SIZE) }));
    }
  }, [filters.offset, state.loading, state.page]);

  const updateFilters = (value: Partial<Filters>) => {
    setFilters(current => ({ ...current, ...value, offset: 0 }));
    setMenuKey(null);
  };
  const clearAdvanced = () => updateFilters({ directory: "", source: "", from: "", to: "", pinned: false });
  const clearQuery = () => { setSearchInput(""); updateFilters({ search: "", directory: "", source: "", from: "", to: "", pinned: false }); };
  const removeCondition = (key: FilterKey) => updateFilters(key === "pinned" ? { pinned: false } : { [key]: "" });
  const open = (row: UnifiedHistoryRow) => {
    setMenuKey(null);
    state.setError("");
    void Promise.resolve().then(() => onOpen(row)).catch(() => state.setError(copy.openFailed));
  };
  const conditions: { key: FilterKey; label: string; value: string }[] = [
    { key: "directory", label: copy.project, value: filters.directory ? (labels.get(filters.directory) ?? filters.directory.split(/[\\/]/).at(-1) ?? filters.directory) : "" },
    { key: "source", label: copy.source, value: filters.source ? copy[filters.source] : "" },
    { key: "from", label: copy.from, value: filters.from },
    { key: "to", label: copy.to, value: filters.to },
    { key: "pinned", label: copy.onlyPinned, value: filters.pinned ? copy.pinnedGroup : "" },
  ];

  return <div ref={root} className="history-organizer" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
    onClick={event => {
      if (!(event.target as HTMLElement).closest(".history-organizer-action-toggle, .history-organizer-row-actions")) setMenuKey(null);
    }}
    onKeyDown={event => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (menuKey) { setMenuKey(null); root.current?.querySelector<HTMLButtonElement>(".history-organizer-action-toggle[aria-expanded='true']")?.focus(); }
        else if (filtersOpen) { setFiltersOpen(false); root.current?.querySelector<HTMLButtonElement>(".history-organizer-filter-toggle")?.focus(); }
        else onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(root.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled)") ?? [])]
        .filter(element => !element.closest("[hidden]"));
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === root.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
    <header className="history-organizer-header" data-tauri-drag-region="">
      <h2 id={titleId}>{copy.title}</h2>
      {onNewChat && <button type="button" className="history-organizer-header-action" onClick={onNewChat}><AppIcon name="add" size={16} />{copy.newChat}</button>}
      <button type="button" className="history-organizer-icon-button" aria-label={copy.close} onClick={onClose}><AppIcon name="close" size={18} /></button>
    </header>
    <div className="history-organizer-toolbar">
      <label className="history-organizer-search" htmlFor={searchId}>
        <MagnifyingGlassIcon size={17} aria-hidden="true" />
        <input id={searchId} type="search" value={searchInput} placeholder={copy.search} aria-label={copy.search}
          onChange={event => { setSearchInput(event.target.value); setMenuKey(null); }} />
      </label>
      <button type="button" className="history-organizer-filter-toggle" aria-expanded={filtersOpen} aria-controls={filterId}
        onClick={() => { setFiltersOpen(value => !value); setMenuKey(null); }}>
        <SlidersHorizontalIcon size={17} aria-hidden="true" />{advancedCount ? `${copy.filters} · ${advancedCount}` : copy.filters}
      </button>
    </div>
    <div id={filterId} className="history-organizer-filters" hidden={!filtersOpen}>
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
      <div className="history-organizer-filter-foot">
        <label className="history-organizer-pin-filter"><input type="checkbox" checked={filters.pinned} onChange={event => updateFilters({ pinned: event.target.checked })} />{copy.onlyPinned}</label>
        <div>
          {advancedCount > 0 && <button type="button" onClick={clearAdvanced}>{copy.clear}</button>}
          <button type="button" disabled={state.loading} onClick={() => { void state.refresh(true); }}><ArrowClockwiseIcon size={15} aria-hidden="true" />{copy.refresh}</button>
        </div>
      </div>
      {filters.tab === "archived" && <p className="history-organizer-note">{copy.archiveNote}</p>}
    </div>
    {advancedCount > 0 && <div className="history-organizer-chips" aria-label={copy.filters}>
      {conditions.filter(condition => condition.value).map(condition => <button type="button" key={condition.key}
        aria-label={`${copy.clearCondition} ${condition.label}`} onClick={() => removeCondition(condition.key)}>
        {condition.key === "pinned" ? condition.label : `${condition.label}：${condition.value}`} <AppIcon name="close" size={16} />
      </button>)}
    </div>}
    <nav className="history-organizer-tabs" aria-label={copy.title}>
      {(["active", "archived"] as const).map(tab => <button type="button" key={tab} aria-pressed={filters.tab === tab}
        onClick={() => updateFilters({ tab })}>{copy[tab]}</button>)}
      <span aria-live="polite">{total} {copy.conversations}</span>
    </nav>
    {invalidDates && <p className="history-organizer-error" role="alert">{copy.invalidDates}</p>}
    {state.page?.offline && <p className="history-organizer-warning history-organizer-status" role="status">{copy.offline}</p>}
    {state.error && <div className="history-organizer-error" role="alert">{state.error} <button disabled={state.loading} onClick={() => { void state.refresh(true); }}>{copy.retry}</button></div>}
    {!!state.page?.errors.length && !state.error && <p className="history-organizer-warning history-organizer-status" role="status">{state.page.errors.join(" · ")}</p>}
    <div ref={results} className="history-organizer-results" aria-busy={state.loading} onScroll={() => setMenuKey(null)}>
      {state.loading && !state.page && <p className="history-organizer-status" role="status">{copy.loading}</p>}
      {!invalidDates && groups.map(group => <section key={group.name} aria-label={group.name}>
        <h3 className="history-organizer-group-title">{group.name}</h3>
        <ul className="history-organizer-list">{group.rows.map(row => <HistoryOrganizerRow key={row.key} row={row} copy={copy} language={language}
          preview={previews.get(row.key)} projectName={row.identity.kind === "native" ? (labels.get(row.identity.directory) ?? row.identity.directory) : copy.localRecord}
          group={group.name} now={now} busy={state.busyKey !== null} menuOpen={menuKey === row.key} onMenuChange={open => setMenuKey(open ? row.key : null)}
          onOpen={open} onMutate={state.mutate} />)}</ul>
      </section>)}
      {!state.loading && !invalidDates && !items.length && <div className="history-organizer-empty">
        <p>{state.page?.offline ? copy.offlineEmpty : filtered ? copy.noResults : copy.empty}</p>
        {filtered && <button type="button" onClick={clearQuery}>{copy.clearQuery}</button>}
      </div>}
    </div>
    {(total > PAGE_SIZE || filters.offset > 0) && <footer className="history-organizer-pagination">
      <span aria-live="polite">{copy.page} {Math.floor(filters.offset / PAGE_SIZE) + 1} {copy.of} {Math.max(1, Math.ceil(total / PAGE_SIZE))}</span>
      <button disabled={state.loading || filters.offset === 0} onClick={() => setFilters(current => ({ ...current, offset: Math.max(0, current.offset - PAGE_SIZE) }))}>{copy.previous}</button>
      <button disabled={state.loading || !state.page?.hasMore} onClick={() => setFilters(current => ({ ...current, offset: current.offset + PAGE_SIZE }))}>{copy.next}</button>
    </footer>}
  </div>;
}
