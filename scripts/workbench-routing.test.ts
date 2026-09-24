import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { transformWorkbenchRouting } from "./workbench-routing";

const entry = readFileSync(resolve(import.meta.dir, "workbench-overlay/workbench/entry.tsx"), "utf8");

test("handoff and ownership retain directory and session identity in the generated native entry", () => {
  // Given the pinned entry's native memory router.
  const transformed = transformWorkbenchRouting(entry, "E:/yume/src/workbench/session-route.ts");
  // When the build adapts the host bridge.
  // Then every route operation uses the composite target, including same-ID project switches.
  expect(transformed).toContain("sessionRoute(event.payload)");
  expect(transformed).toContain('from "E:/yume/src/workbench/session-route.ts"');
  expect(transformed).toContain('bridge.core.invoke("workbench_resolve_session", { sessionId })');
  expect(transformed).toContain("syncWorkbenchOwnership = createSessionOwnershipRouter(");
  expect(transformed).toContain("directory: session.directory");
  expect(transformed).toContain("...JSON.parse(next)");
  expect(transformed).not.toContain("/server/${base64Encode(\"sidecar\")}/session/");
});

test("a changed upstream bridge fails the build instead of silently dropping scope", () => {
  // Given an incompatible entry.
  // When adaptation runs.
  // Then failure is explicit.
  expect(() => transformWorkbenchRouting("// incompatible upstream", "E:/yume/src/workbench/session-route.ts")).toThrow();
});
