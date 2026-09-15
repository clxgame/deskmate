import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ToolPermissionsTab } from "./ToolPermissionsTab";
import { dict } from "../lib/i18n";
import { legacySettingsFixture } from "../testing/settingsFixtures";
import { DEFAULT_TOOL_PERMISSIONS } from "../lib/toolPermissions";

afterEach(cleanup);
test("old settings show safe defaults and changing one permission preserves the others", () => {
  const calls: unknown[] = [];
  const ui = render(<ToolPermissionsTab settings={legacySettingsFixture()} patch={(key,value)=>calls.push({key,value})} t={dict("zh-CN")} />);
  expect(ui.getByRole("combobox",{name:"执行命令"})).toHaveProperty("value","ask");
  fireEvent.change(ui.getByRole("combobox",{name:"查询记录"}), {target:{value:"deny"}});
  expect(calls).toEqual([{key:"toolPermissions",value:{...DEFAULT_TOOL_PERMISSIONS,worklogRead:"deny"}}]);
});
test("all supported modes remain selectable for a persisted policy", () => {
  const ui=render(<ToolPermissionsTab settings={legacySettingsFixture({toolPermissions:{...DEFAULT_TOOL_PERMISSIONS,shell:"deny"}})} patch={()=>{}} t={dict("en-US")} />);
  expect(ui.getByRole("combobox",{name:"Run commands"})).toHaveProperty("value","deny");
  expect(ui.getAllByRole("combobox")).toHaveLength(4);
  expect(ui.getAllByRole("option",{name:"Ask every time"})).toHaveLength(4);
});
