import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import * as core from "@tauri-apps/api/core";
import { dict } from "../lib/i18n";
import { legacySettingsFixture } from "../testing/settingsFixtures";
import { DEFAULT_TOOL_PERMISSIONS } from "../lib/toolPermissions";
import { restoreTauriModuleFixture } from "../testing/tauriModuleFixture";

const invoke = mock<(command: string, args?: unknown) => Promise<unknown>>(() => Promise.resolve([]));
mock.module("@tauri-apps/api/core", () => ({ ...core, invoke }));
const { ToolPermissionsTab } = await import("./ToolPermissionsTab");

beforeEach(() => { mock.module("@tauri-apps/api/core", () => ({ ...core, invoke })); invoke.mockReset(); invoke.mockResolvedValue([]); });
afterEach(() => { cleanup(); restoreTauriModuleFixture(); });
test("old settings show safe defaults and changing one permission preserves the others", () => {
  const calls: unknown[] = [];
  const ui = render(<ToolPermissionsTab settings={legacySettingsFixture()} patch={(key,value)=>calls.push({key,value})} t={dict("zh-CN")} />);
  expect(ui.getByRole("combobox",{name:"执行命令"})).toHaveProperty("value","ask");
  fireEvent.change(ui.getByRole("combobox",{name:"查询记录"}), {target:{value:"deny"}});
  expect(calls).toEqual([{key:"toolPermissions",value:{...DEFAULT_TOOL_PERMISSIONS,worklogRead:"deny"}}]);
});
test("desktop collaboration is opt in and each switch updates only its setting", () => {
  const calls: unknown[] = [];
  const ui = render(<ToolPermissionsTab settings={legacySettingsFixture()} patch={(key,value)=>calls.push({key,value})} t={dict("en-US")} />);
  const browser = ui.getByRole("checkbox", {name:"Isolated browser control"});
  const windows = ui.getByRole("checkbox", {name:"Windows UI control"});
  expect(browser).toHaveProperty("checked", false);
  expect(windows).toHaveProperty("checked", false);
  fireEvent.click(browser);
  fireEvent.click(windows);
  expect(calls).toEqual([
    {key:"browserMcpEnabled",value:true},
    {key:"windowsMcpEnabled",value:true},
  ]);
});
test("all supported modes remain selectable for a persisted policy", () => {
  const ui=render(<ToolPermissionsTab settings={legacySettingsFixture({toolPermissions:{...DEFAULT_TOOL_PERMISSIONS,shell:"deny"}})} patch={()=>{}} t={dict("en-US")} />);
  expect(ui.getByRole("combobox",{name:"Run commands"})).toHaveProperty("value","deny");
  expect(ui.getAllByRole("combobox")).toHaveLength(4);
  expect(ui.getAllByRole("option",{name:"Ask every time"})).toHaveLength(4);
});
test("remembered workspace rules can be revoked", async () => {
  const approval = { workspacePath: "E:\\Codex\\yume\\snake", permission: "bash", pattern: "Get-ChildItem *" };
  const ui=render(<ToolPermissionsTab settings={legacySettingsFixture({agentPermissionApprovals:[approval]})} patch={()=>{}} t={dict("zh-CN")} />);
  expect(ui.getByText("Get-ChildItem *")).toBeDefined();
  fireEvent.click(ui.getByRole("button",{name:"撤销"}));
  await waitFor(()=>expect(invoke.mock.calls).toContainEqual(["agent_permission_approval_remove",{approval}]));
  await waitFor(()=>expect(ui.queryByText("Get-ChildItem *")).toBeNull());
});
