import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AppIcon } from "../ui/AppIcon";
import { catalogModels, sameModel, selectionForModel, type ChatModelCatalog, type ChatModelChoice, type ConversationModelSelection } from "../lib/conversationModel";
import { composerCopy, folderErrorCopy, modelErrorCopy } from "./composerCopy";
import { ComposerPopover } from "./ComposerPopover";

function basename(path: string) { return path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? path; }

export function WorkspacePicker({ language, workspace, locked, onSelect, onLeave, open: controlledOpen, onOpenChange }: {
  readonly language: string; readonly workspace: string | null; readonly locked: boolean;
  readonly onSelect: (path?: string) => Promise<void>; readonly onLeave: () => Promise<void>;
  readonly open?: boolean; readonly onOpenChange?: (open: boolean) => void;
}) {
  const copy = composerCopy(language);
  const trigger = useRef<HTMLButtonElement>(null);
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const setOpen = onOpenChange ?? setLocalOpen;
  const [recent, setRecent] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    void invoke<string[]>("history_recent_workspaces").then(items => { if (!disposed) setRecent(Array.isArray(items) ? items : []); })
      .catch(() => { if (!disposed) setRecent([]); });
    return () => { disposed = true; };
  }, [open, workspace]);
  const select = async (path?: string) => {
    try { await onSelect(path); setError(null); setOpen(false); trigger.current?.focus(); }
    catch (cause) { setError(folderErrorCopy(language, cause)); setOpen(true); }
  };
  return <div className="composer-picker">
    <button ref={trigger} type="button" className="composer-tool composer-folder" aria-haspopup="menu" aria-expanded={open}
      aria-label={workspace ? `${copy.folder}: ${workspace}` : copy.folder}
      title={workspace ?? (locked ? copy.folderLocked : copy.folder)}
      onClick={() => { if (!workspace && recent.length === 0 && !locked) void select(); else setOpen(!open); }}>
      <AppIcon name="folder" size={16} /><span>{workspace ? basename(workspace) : copy.folder}</span><span aria-hidden="true">⌄</span>
    </button>
    {open && <ComposerPopover trigger={trigger} label={copy.folder} onClose={() => setOpen(false)}>
      {locked ? <p className="composer-popover-note">{copy.folderLocked}</p> : <>
        {recent.length > 0 && <p className="composer-popover-heading">{copy.recentFolders}</p>}
        {recent.map(path => <button type="button" role="menuitem" key={path} title={path} onClick={() => void select(path)}>
          <span className="composer-ellipsis">{basename(path)}</span><small className="composer-ellipsis">{path}</small>
        </button>)}
        <button type="button" role="menuitem" onClick={() => void select()}>{copy.otherFolder}</button>
        {workspace && <button type="button" role="menuitem" onClick={() => void onLeave().then(() => setOpen(false)).catch(cause => setError(folderErrorCopy(language, cause)))}>{copy.leaveFolder}</button>}
        {error && <p role="alert" className="composer-popover-error">{error}</p>}
      </>}
    </ComposerPopover>}
  </div>;
}

export function ModelPicker({ language, selection, resolved, locked, onSelect, onManage, open: controlledOpen, onOpenChange }: {
  readonly language: string; readonly selection: ConversationModelSelection; readonly resolved: ChatModelChoice | null;
  readonly locked: boolean; readonly onSelect: (selection: ConversationModelSelection) => Promise<void>;
  readonly onManage: () => void;
  readonly open?: boolean; readonly onOpenChange?: (open: boolean) => void;
}) {
  const copy = composerCopy(language);
  const trigger = useRef<HTMLButtonElement>(null);
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const setOpen = onOpenChange ?? setLocalOpen;
  const [catalog, setCatalog] = useState<ChatModelCatalog | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const generation = useRef(0);
  const refresh = () => {
    const token = ++generation.current;
    setLoading(true); setError(null);
    void catalogModels().then(value => { if (token === generation.current) setCatalog(value); })
      .catch(cause => { if (token === generation.current) setError(modelErrorCopy(language, cause)); })
      .finally(() => { if (token === generation.current) setLoading(false); });
  };
  useEffect(() => { if (open) refresh(); else generation.current += 1; }, [open]);
  const choose = async (next: ConversationModelSelection) => {
    try { await onSelect(next); setOpen(false); setSearch(""); trigger.current?.focus(); }
    catch (cause) { setError(modelErrorCopy(language, cause)); }
  };
  const ordered = [...(catalog?.models ?? [])].sort((a, b) => {
    if (resolved && sameModel(a, resolved)) return -1;
    if (resolved && sameModel(b, resolved)) return 1;
    return a.modelName.localeCompare(b.modelName) || a.modelId.localeCompare(b.modelId);
  }).filter(model => `${model.modelName} ${model.modelId}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="composer-picker composer-model">
    <button ref={trigger} type="button" className="composer-tool" aria-haspopup="menu" aria-expanded={open}
      title={resolved ? `${resolved.modelName} (${resolved.modelId})` : copy.modelInvalid}
      onClick={() => setOpen(!open)}>
      <span className="composer-ellipsis">{resolved?.modelName ?? (selection.mode === "override" ? copy.modelInvalid : copy.model)}</span><span aria-hidden="true">⌄</span>
    </button>
    {open && <ComposerPopover trigger={trigger} label={copy.model} onClose={() => setOpen(false)}>
      {locked ? <p className="composer-popover-note">{copy.modelLocked}</p> : <>
        <button type="button" role="menuitemradio" aria-checked={selection.mode === "inherit"} onClick={() => void choose({ mode: "inherit" })}>
          {selection.mode === "inherit" ? "✓ " : ""}{copy.inherit}{catalog?.defaultModel ? ` · ${catalog.defaultModel.modelName}` : ""}
        </button>
        {catalog && catalog.models.length > 6 && <input className="composer-search" value={search} onChange={event => setSearch(event.target.value)} placeholder={copy.search} aria-label={copy.search} />}
        {ordered.map(model => <button type="button" role="menuitemradio" aria-checked={selection.mode === "override" && selection.configuredProviderId === model.configuredProviderId && selection.sidecarId === model.sidecarId && selection.modelId === model.modelId}
          key={`${model.configuredProviderId}/${model.sidecarId}/${model.modelId}`} title={model.modelId}
          onClick={() => void choose(selectionForModel(model))}>
          <span className="composer-ellipsis">{selection.mode === "override" && selection.modelId === model.modelId ? "✓ " : ""}{model.modelName}</span>
          <small className="composer-ellipsis">{model.modelId}</small>
        </button>)}
        {loading && <p className="composer-popover-note" role="status">…</p>}
        {!loading && !error && catalog?.models.length === 0 && <p className="composer-popover-note">{copy.noModels}</p>}
        {error && <p className="composer-popover-error" role="alert">{error} <button type="button" onClick={refresh}>{copy.retry}</button></p>}
        <button type="button" role="menuitem" onClick={() => { setOpen(false); onManage(); }}>{copy.manageModels}</button>
      </>}
    </ComposerPopover>}
  </div>;
}
