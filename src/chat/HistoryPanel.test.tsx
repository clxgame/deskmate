import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { dict } from "../lib/i18n";

const calls: Array<{ command: string; args?: object }> = [];
let deleteFailure: unknown = null;

mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args?: object) => {
    calls.push({ command, args });
    if (command === "history_list") {
      return [{
        id: "ses_agent",
        title: "Recovered task",
        created: 1,
        updated: 2,
        count: 2,
        agentDetails: {
          workspacePath: "C:\\workspaces\\original",
          status: "active",
          source: "interactive",
          availability: "ready",
        },
      }];
    }
    if (command === "history_delete" && deleteFailure !== null) throw deleteFailure;
    return undefined;
  },
}));

const { HistoryPanel } = await import("./ChatApp");

afterEach(() => {
  cleanup();
  calls.length = 0;
  deleteFailure = null;
});

test("shows host-derived workspace and task status for Agent history", async () => {
  render(<HistoryPanel t={dict("en-US")} onContinue={() => {}} onNewChat={() => {}} onDelete={async () => {}} />);
  expect(await screen.findByText("C:\\workspaces\\original · active")).toBeDefined();
});

test("keeps a running Agent history and skips associated cleanup when host rejects deletion", async () => {
  deleteFailure = "history_agent_running";
  let attachmentCleanup = 0;
  render(<HistoryPanel
    t={dict("en-US")}
    onContinue={() => {}}
    onNewChat={() => {}}
    onDelete={async () => { attachmentCleanup += 1; }}
  />);
  await screen.findByText("Recovered task");
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));

  expect((await screen.findByRole("alert")).textContent).toContain("Stop the running task");
  expect(screen.getByText("Recovered task")).toBeDefined();
  expect(attachmentCleanup).toBe(0);
  await waitFor(() => {
    expect(calls.filter(({ command }) => command === "history_delete")).toHaveLength(1);
  });
  expect(calls.some(({ command }) => command === "memory_forget_conversation")).toBe(false);
});
