import { useEffect, useState } from "react";
import {
  DEFAULT_TOOL_PERMISSIONS,
  removeAgentPermissionApproval,
  type AgentPermissionApproval,
  type PermissionMode,
  type ToolPermissions,
} from "../lib/toolPermissions";
import type { PersistSettings, TabProps } from "./settingsPrimitives";

const PERMISSION_KEYS = ["worklogRead", "worklogWrite", "web", "shell"] as const;
const MODES = ["allow", "ask", "deny"] as const;
type DesktopTool = "browserMcpEnabled" | "windowsMcpEnabled";

export function ToolPermissionsTab({ settings, patch, persist, t }: TabProps & { readonly persist: PersistSettings }) {
  const permissions = settings.toolPermissions ?? DEFAULT_TOOL_PERMISSIONS;
  const [helpOpen, setHelpOpen] = useState(false);
  const [approvalsOpen, setApprovalsOpen] = useState(false);
  const [approvals, setApprovals] = useState<readonly AgentPermissionApproval[]>(settings.agentPermissionApprovals ?? []);
  const [pending, setPending] = useState<{ key: DesktopTool; enabled: boolean } | null>(null);
  const [applying, setApplying] = useState(false);
  const [changeFailed, setChangeFailed] = useState(false);
  const [removeFailed, setRemoveFailed] = useState(false);

  useEffect(() => setApprovals(settings.agentPermissionApprovals ?? []), [settings.agentPermissionApprovals]);

  function change(key: keyof ToolPermissions, value: string) {
    const mode: PermissionMode | undefined = MODES.find((item) => item === value);
    if (mode) patch("toolPermissions", { ...permissions, [key]: mode });
  }

  async function applyDesktopChange() {
    if (!pending || applying) return;
    setApplying(true);
    setChangeFailed(false);
    try {
      await persist({ ...settings, [pending.key]: pending.enabled });
      setPending(null);
    } catch (error: unknown) {
      setPending(null);
      setChangeFailed(true);
      console.error("Desktop tool setting change failed", error instanceof Error ? error.message : String(error));
    } finally {
      setApplying(false);
    }
  }

  async function remove(approval: AgentPermissionApproval) {
    setRemoveFailed(false);
    try {
      setApprovals(await removeAgentPermissionApproval(approval));
    } catch (error: unknown) {
      setRemoveFailed(true);
      console.error("Agent permission approval removal failed", error instanceof Error ? error.message : String(error));
    }
  }

  const pendingLabel = pending?.key === "browserMcpEnabled" ? t.permissionBrowserMcp : t.permissionWindowsMcp;

  return <section className="set-permissions" aria-label={t.tabPermissions}>
    <div className="set-permissions-head">
      <h2>{t.tabPermissions}</h2>
      <button type="button" className="set-permissions-link" aria-expanded={helpOpen} aria-controls="set-permissions-help" onClick={() => setHelpOpen((open) => !open)}>{t.permissionDetails}</button>
    </div>
    <p className="set-permissions-intro">{t.permissionScopeBrief}</p>
    <div id="set-permissions-help" className="set-permissions-help" hidden={!helpOpen}>
      <p>{t.permissionScope}</p>
      {PERMISSION_KEYS.map((key) => <p key={key}><strong>{t.permissionLabels[key]}：</strong>{t.permissionDescriptions[key]}</p>)}
      <p>{t.permissionBrowserMcpDescription}</p>
      <p>{t.permissionWindowsMcpDescription}</p>
      <p>{t.permissionDesktopToolsRestart}</p>
    </div>

    <div className="set-permissions-list">
      {PERMISSION_KEYS.map((key) => <div className="set-permissions-row" key={key}>
        <label htmlFor={`set-permission-${key}`}>{t.permissionLabels[key]}</label>
        <select id={`set-permission-${key}`} className="set-permissions-select" value={permissions[key]} disabled={applying} onChange={(event) => change(key, event.target.value)}>
          {MODES.map((mode) => <option key={mode} value={mode}>{t.permissionModes[mode]}</option>)}
        </select>
      </div>)}
    </div>

    <div className="set-permissions-tools">
      <label className="set-permissions-row set-permissions-switch" htmlFor="set-permissions-browser">
        <span>{t.permissionBrowserMcp}</span>
        <input id="set-permissions-browser" type="checkbox" checked={settings.browserMcpEnabled ?? false} disabled={applying} onChange={(event) => { setChangeFailed(false); setPending({ key: "browserMcpEnabled", enabled: event.target.checked }); }} />
      </label>
      <label className="set-permissions-row set-permissions-switch" htmlFor="set-permissions-windows">
        <span>{t.permissionWindowsMcp}</span>
        <input id="set-permissions-windows" type="checkbox" checked={settings.windowsMcpEnabled ?? false} disabled={applying} onChange={(event) => { setChangeFailed(false); setPending({ key: "windowsMcpEnabled", enabled: event.target.checked }); }} />
      </label>
    </div>

    {pending && <div className="set-permissions-confirm" role="group" aria-label={t.permissionDesktopChangeTitle(pendingLabel, pending.enabled)}>
      <strong>{t.permissionDesktopChangeTitle(pendingLabel, pending.enabled)}</strong>
      <p>{t.permissionDesktopChangeWarning}</p>
      <div className="set-permissions-confirm-actions">
        <button type="button" className="set-permissions-apply" disabled={applying} onClick={() => void applyDesktopChange()}>{t.permissionApplyChange}</button>
        <button type="button" className="set-permissions-link" disabled={applying} onClick={() => { setPending(null); setChangeFailed(false); }}>{t.permissionCancel}</button>
      </div>
    </div>}
    {changeFailed && <p className="set-permissions-feedback" role="alert">{t.permissionChangeFailed}</p>}

    <div className="set-permissions-row set-permissions-approvals-head">
      <span>{t.permissionSavedApprovals}</span>
      <button type="button" className="set-permissions-link" aria-expanded={approvalsOpen} aria-controls="set-permissions-approvals" onClick={() => setApprovalsOpen((open) => !open)}>{approvalsOpen ? t.permissionHideApprovals : t.permissionViewApprovals}</button>
    </div>
    <div id="set-permissions-approvals" hidden={!approvalsOpen}>
      {approvals.length === 0 ? <p className="set-permissions-empty">{t.permissionSavedApprovalsEmpty}</p> : <ul className="set-permissions-rules">
        {approvals.map((approval) => <li key={`${approval.workspacePath}\u0000${approval.permission}\u0000${approval.pattern}`}>
          <span><strong>{approval.pattern}</strong><small>{approval.workspacePath}</small></span>
          <button type="button" className="set-permissions-link set-permissions-remove" onClick={() => void remove(approval)}>{t.permissionRemoveApproval}</button>
        </li>)}
      </ul>}
      {removeFailed && <p className="set-note set-note-error" role="alert">{t.permissionApprovalRemoveFailed}</p>}
    </div>
  </section>;
}
