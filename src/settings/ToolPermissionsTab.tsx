import { DEFAULT_TOOL_PERMISSIONS, type PermissionMode, type ToolPermissions } from "../lib/toolPermissions";
import { Row, type TabProps } from "./settingsPrimitives";

const GROUPS = [
  { title: "permissionWorklog", rows: ["worklogRead", "worklogWrite"] },
  { title: "permissionNetwork", rows: ["web"] },
  { title: "permissionSystem", rows: ["shell"] },
] as const;
const MODES = ["allow", "ask", "deny"] as const;

export function ToolPermissionsTab({ settings, patch, t }: TabProps) {
  const permissions = settings.toolPermissions ?? DEFAULT_TOOL_PERMISSIONS;
  function change(key: keyof ToolPermissions, value: string) {
    const mode: PermissionMode | undefined = MODES.find((mode) => mode === value);
    if (mode) patch("toolPermissions", { ...permissions, [key]: mode });
  }
  return <>
    <p className="set-note">{t.permissionScope}</p>
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
  </>;
}
