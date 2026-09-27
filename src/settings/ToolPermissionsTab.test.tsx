import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import * as core from "@tauri-apps/api/core";
import { dict } from "../lib/i18n";
import { legacySettingsFixture } from "../testing/settingsFixtures";
import { DEFAULT_TOOL_PERMISSIONS } from "../lib/toolPermissions";
import { restoreTauriModuleFixture } from "../testing/tauriModuleFixture";
import type { Settings } from "../lib/settings";

const invoke = mock<(command: string, args?: unknown) => Promise<unknown>>(() => Promise.resolve([]));
mock.module("@tauri-apps/api/core", () => ({ ...core, invoke }));
const { ToolPermissionsTab } = await import("./ToolPermissionsTab");

beforeEach(() => { mock.module("@tauri-apps/api/core", () => ({ ...core, invoke })); invoke.mockReset(); invoke.mockResolvedValue([]); });
afterEach(() => { cleanup(); restoreTauriModuleFixture(); });
test("old settings show safe defaults and changing one permission preserves the others", () => {
  const calls: unknown[] = [];
  const ui = render(<ToolPermissionsTab settings={legacySettingsFixture()} patch={(key,value)=>calls.push({key,value})} persist={async () => {}} t={dict("zh-CN")} />);
  expect(ui.getByRole("combobox",{name:"执行命令"})).toHaveProperty("value","ask");
  fireEvent.change(ui.getByRole("combobox",{name:"查询记录"}), {target:{value:"deny"}});
  expect(calls).toEqual([{key:"toolPermissions",value:{...DEFAULT_TOOL_PERMISSIONS,worklogRead:"deny"}}]);
});
test("desktop tools require an explicit apply after the restart warning", async () => {
  const saved: Settings[] = [];
  const ui = render(<ToolPermissionsTab settings={legacySettingsFixture()} patch={() => {}} persist={async (next) => { saved.push(next); }} t={dict("en-US")} />);
  const browser = ui.getByRole("checkbox", {name:"Isolated browser control"});
  const windows = ui.getByRole("checkbox", {name:"Windows UI control"});
  expect(browser).toHaveProperty("checked", false);
  expect(windows).toHaveProperty("checked", false);
  fireEvent.click(browser);
  expect(ui.getByText("This restarts the AI service and interrupts active tasks.")).toBeDefined();
  expect(saved).toHaveLength(0);
  fireEvent.click(ui.getByRole("button", {name:"Cancel"}));
  expect(saved).toHaveLength(0);
  expect(browser).toHaveProperty("checked", false);
  fireEvent.click(windows);
  fireEvent.click(ui.getByRole("button", {name:"Apply change"}));
  await waitFor(() => expect(saved).toHaveLength(1));
  expect(saved[0]?.browserMcpEnabled).toBeUndefined();
  expect(saved[0]?.windowsMcpEnabled).toBe(true);
  await waitFor(() => expect(ui.queryByText("This restarts the AI service and interrupts active tasks.")).toBeNull());
});
test("a failed desktop change reports its status without keeping a stale pending action", async () => {
  const logged = spyOn(console, "error").mockImplementation(() => {});
  try {
    const ui = render(<ToolPermissionsTab settings={legacySettingsFixture()} patch={() => {}} persist={async () => { throw new Error("restart failed"); }} t={dict("en-US")} />);
    fireEvent.click(ui.getByRole("checkbox", {name:"Isolated browser control"}));
    fireEvent.click(ui.getByRole("button", {name:"Apply change"}));
    await waitFor(() => expect(ui.getByRole("alert").textContent).toContain("did not fully take effect"));
    expect(ui.queryByRole("button", {name:"Apply change"})).toBeNull();
  } finally {
    logged.mockRestore();
  }
});
test("all supported modes remain selectable for a persisted policy", () => {
  const ui=render(<ToolPermissionsTab settings={legacySettingsFixture({toolPermissions:{...DEFAULT_TOOL_PERMISSIONS,shell:"deny"}})} patch={()=>{}} persist={async () => {}} t={dict("en-US")} />);
  expect(ui.getByRole("combobox",{name:"Run commands"})).toHaveProperty("value","deny");
  expect(ui.getAllByRole("combobox")).toHaveLength(4);
  expect(ui.getAllByRole("option",{name:"Ask every time"})).toHaveLength(4);
});
test("remembered workspace rules can be revoked", async () => {
  const approval = { workspacePath: "E:\\Codex\\yume\\snake", permission: "bash", pattern: "Get-ChildItem *" };
  const ui=render(<ToolPermissionsTab settings={legacySettingsFixture({agentPermissionApprovals:[approval]})} patch={()=>{}} persist={async () => {}} t={dict("zh-CN")} />);
  expect(ui.getByText("Get-ChildItem *").closest("#set-permissions-approvals")?.hasAttribute("hidden")).toBe(true);
  fireEvent.click(ui.getByRole("button",{name:"查看"}));
  expect(ui.getByText("Get-ChildItem *").closest("#set-permissions-approvals")?.hasAttribute("hidden")).toBe(false);
  fireEvent.click(ui.getByRole("button",{name:"撤销"}));
  await waitFor(()=>expect(invoke.mock.calls).toContainEqual(["agent_permission_approval_remove",{approval}]));
  await waitFor(()=>expect(ui.queryByText("Get-ChildItem *")).toBeNull());
});
test("explanations are available when requested and absent from the default list", () => {
  const ui=render(<ToolPermissionsTab settings={legacySettingsFixture()} patch={()=>{}} persist={async () => {}} t={dict("zh-CN")} />);
  expect(ui.getByText(/命令权限单独生效/).closest("#set-permissions-help")?.hasAttribute("hidden")).toBe(true);
  fireEvent.click(ui.getByRole("button",{name:"说明"}));
  expect(ui.getByText(/命令权限单独生效/).closest("#set-permissions-help")?.hasAttribute("hidden")).toBe(false);
});
