import { useEffect, useState } from "react";
import {
  DEFAULT_TOOL_PERMISSIONS,
  removeAgentPermissionApproval,
  type AgentPermissionApproval,
  type PermissionMode,
  type ToolPermissions,
} from "../lib/toolPermissions";
import { Row, Switch, type TabProps } from "./settingsPrimitives";

const GROUPS = [
  { title: "permissionWorklog", rows: ["worklogRead", "worklogWrite"] },
  { title: "permissionNetwork", rows: ["web"] },
  { title: "permissionSystem", rows: ["shell"] },
] as const;
const MODES = ["allow", "ask", "deny"] as const;

export function ToolPermissionsTab({ settings, patch, t }: TabProps) {
  const permissions = settings.toolPermissions ?? DEFAULT_TOOL_PERMISSIONS;
  const [approvals, setApprovals] = useState<readonly AgentPermissionApproval[]>(settings.agentPermissionApprovals ?? []);
  const [removeFailed, setRemoveFailed] = useState(false);
  useEffect(() => setApprovals(settings.agentPermissionApprovals ?? []), [settings.agentPermissionApprovals]);
  function change(key: keyof ToolPermissions, value: string) {
    const mode: PermissionMode | undefined = MODES.find((mode) => mode === value);
    if (mode) patch("toolPermissions", { ...permissions, [key]: mode });
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
  return <>
    <p className="set-note">{t.permissionScope}</p>
    <section aria-label={t.permissionDesktopTools}>
      <h3 className="set-permission-heading">{t.permissionDesktopTools}</h3>
      <Row label={t.permissionBrowserMcp}>
        <Switch checked={settings.browserMcpEnabled ?? false} onChange={(value) => patch("browserMcpEnabled", value)} label={t.permissionBrowserMcp} />
      </Row>
      <p className="set-note">{t.permissionBrowserMcpDescription}</p>
      <Row label={t.permissionWindowsMcp}>
        <Switch checked={settings.windowsMcpEnabled ?? false} onChange={(value) => patch("windowsMcpEnabled", value)} label={t.permissionWindowsMcp} />
      </Row>
      <p className="set-note">{t.permissionWindowsMcpDescription}</p>
      <p className="set-note">{t.permissionDesktopToolsRestart}</p>
    </section>
    {GROUPS.map((group) => <section key={group.title} aria-label={t[group.title]}>
      <h3 className="set-permission-heading">{t[group.title]}</h3>
      {group.rows.map((key) => <div key={key}>
        <Row label={t.permissionLabels[key]}>
          <select className="set-select" aria-label={t.permissionLabels[key]} value={permissions[key]} onChange={(event) => change(key, event.target.value)}>
            {MODES.map((mode) => <option key={mode} value={mode}>{t.permissionModes[mode]}</option>)}
          </select>
        </Row>
        <p className="set-note">{t.permissionDescriptions[key]}</p>
      </div>)}
    </section>)}
    <section aria-label={t.permissionSavedApprovals}>
      <h3 className="set-permission-heading">{t.permissionSavedApprovals}</h3>
      {approvals.length === 0 ? <p className="set-note">{t.permissionSavedApprovalsEmpty}</p> : <ul className="set-permission-rules">
        {approvals.map((approval) => <li key={`${approval.workspacePath}\u0000${approval.permission}\u0000${approval.pattern}`} className="set-permission-rule">
          <span><strong>{approval.pattern}</strong><small title={approval.workspacePath}>{approval.workspacePath}</small></span>
          <button type="button" className="set-btn set-btn-danger" onClick={() => void remove(approval)}>{t.permissionRemoveApproval}</button>
        </li>)}
      </ul>}
      {removeFailed && <p className="set-note set-note-error" role="alert">{t.permissionApprovalRemoveFailed}</p>}
    </section>
  </>;
}
