import { describe, expect, test } from "bun:test";
import { syncWorkbenchTheme, type WorkbenchThemeHost } from "./theme-sync";

describe("workbench host theme sync", () => {
  test("reads the initial host choice and applies live events without remounting", async () => {
    const applied: string[] = [];
    let notify: ((event: { payload: string }) => void) | undefined;
    const host: WorkbenchThemeHost = {
      core: { invoke: async () => "mint" },
      event: { listen: async (_name, handler) => {
        notify = handler;
        return () => {};
      } },
    };
    await syncWorkbenchTheme(host, (theme) => applied.push(theme), () => { throw new Error("unexpected sync error"); });
    notify?.({ payload: "peach" });
    notify?.({ payload: "lavender" });
    expect(applied).toEqual(["mint", "peach", "lavender"]);
  });

  test("reports listener failure but still reads the host theme", async () => {
    const applied: string[] = [];
    const errors: string[] = [];
    const host: WorkbenchThemeHost = {
      core: { invoke: async () => "dark" },
      event: { listen: async () => { throw new Error("event unavailable"); } },
    };
    await syncWorkbenchTheme(host, (theme) => applied.push(theme), (phase) => errors.push(phase));
    expect(applied).toEqual(["dark"]);
    expect(errors).toEqual(["listen"]);
  });
});
