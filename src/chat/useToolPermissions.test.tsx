import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import * as core from "@tauri-apps/api/core";
import { restoreTauriModuleFixture } from "../testing/tauriModuleFixture";
import type { PermissionRequest } from "../lib/toolPermissions";
const invoke = mock<(command: string, args?: unknown) => Promise<unknown>>(() => Promise.resolve([]));
mock.module("@tauri-apps/api/core", () => ({ ...core, invoke }));
const { useToolPermissions } = await import("./useToolPermissions");
const request: PermissionRequest = { id: "p1", sessionID: "old", permission: "bash", patterns: ["echo test"], metadata: {} };
beforeEach(() => { mock.module("@tauri-apps/api/core", () => ({ ...core, invoke })); invoke.mockReset(); invoke.mockResolvedValue([]); });
afterEach(() => { cleanup(); restoreTauriModuleFixture(); });

test("stopping clears cards, cancels pending engine requests and ignores a late poll", async () => {
  let finish: (value: readonly PermissionRequest[]) => void = () => {};
  const response = new Promise<readonly PermissionRequest[]>((resolve) => { finish = resolve; });
  invoke.mockImplementation(async (command) => command === "tool_permission_pending" ? response : null);
  const hook = renderHook(({ busy }) => useToolPermissions("old", busy), { initialProps: { busy: true } });
  hook.rerender({ busy: false });
  await act(async () => { finish([request]); await response; });
  expect(hook.result.current.requests).toEqual([]);
  expect(invoke.mock.calls.filter(([command]) => command === "tool_permission_cancel")).toEqual([["tool_permission_cancel", { sessionId: "old" }]]);
  await act(async () => { await hook.result.current.reply(request, "once"); });
  expect(invoke.mock.calls.some(([command]) => command === "tool_permission_reply")).toBe(false);
});

test("switching chats cancels the old request and cannot approve it in the new chat", async () => {
  invoke.mockImplementation(async (command, args) => command === "tool_permission_pending" && JSON.stringify(args).includes("old") ? [request] : []);
  const hook = renderHook(({ session }) => useToolPermissions(session, true), { initialProps: { session: "old" } });
  await waitFor(() => expect(hook.result.current.requests).toHaveLength(1));
  hook.rerender({ session: "new" });
  await act(async () => { await hook.result.current.reply(request, "once"); });
  expect(hook.result.current.requests).toEqual([]);
  expect(invoke.mock.calls.some(([command]) => command === "tool_permission_reply")).toBe(false);
  expect(invoke.mock.calls).toContainEqual(["tool_permission_cancel", { sessionId: "old" }]);
});
