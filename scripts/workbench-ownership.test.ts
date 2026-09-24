import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createSessionOwnershipRouter, sessionRoute, sessionTargetFromUrl } from "../src/workbench/session-route";
import { transformWorkbenchRouting } from "./workbench-routing";

test("native show reclaims the current scope after hidden rejection without DOM visibilitychange", async () => {
  // Given the real generated ownership bridge running against a native host boundary.
  const entry = readFileSync(resolve(import.meta.dir, "../../opencode-v1.18.21/packages/app/workbench/entry.tsx"), "utf8");
  const adapted = transformWorkbenchRouting(entry, "E:/yume/src/workbench/session-route.ts");
  const start = adapted.indexOf("  if (bridge) {\n    let routedSessionId");
  const end = adapted.indexOf("  // In-place navigation", start);
  expect(start).toBeGreaterThan(0);
  const code = new Bun.Transpiler({ loader: "ts" }).transformSync(adapted.slice(start, end));
  const document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  let tick = () => {};
  const window = Object.assign(new EventTarget(), {
    setInterval: (callback: () => void) => { tick = callback; return 1; },
    clearInterval: (_id: number) => {},
  });
  let visible = true;
  let owned = false;
  const claimed: unknown[] = [];
  const listeners = new Map<string, () => void>();
  const bridge = {
    core: { invoke: async (command: string, target: unknown) => {
      if (command === "workbench_claim_session") {
        if (!visible) throw new Error("workbench_window_hidden");
        owned = true;
        claimed.push(target);
      }
      if (command === "workbench_release_session") owned = false;
      if (command === "workbench_heartbeat") return owned && visible;
      return undefined;
    } },
    event: { listen: async (name: string, callback: () => void) => {
      listeners.set(name, callback);
      return () => { listeners.delete(name); };
    } },
  };
  const target = { directory: "C:/selected-project", sessionId: "ses_selected" };
  const drain = async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); };
  new Function("bridge", "document", "window", "initialUrl", "sessionTargetFromUrl", "createSessionOwnershipRouter", `let syncWorkbenchOwnership;\n${code}`)(
    bridge, document, window, sessionRoute(target), sessionTargetFromUrl, createSessionOwnershipRouter,
  );
  await drain();
  expect(owned).toBe(true);
  visible = false;
  owned = false;
  tick();
  await drain();
  expect(owned).toBe(false);
  // When the native host shows the unchanged route and sends its shown event.
  visible = true;
  listeners.get("workbench://shown")?.();
  await drain();
  // Then the same composite session is reclaimed and the listener cleans up on unload.
  expect(owned).toBe(true);
  expect(claimed).toEqual([target, target]);
  window.dispatchEvent(new Event("pagehide"));
  await drain();
  expect(listeners.size).toBe(0);
});
