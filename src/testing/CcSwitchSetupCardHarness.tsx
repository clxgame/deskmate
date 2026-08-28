import { mock } from "bun:test";
import * as tauriCore from "@tauri-apps/api/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

export const invoke = mock<(command: string, args?: unknown) => Promise<unknown>>(
  () => Promise.resolve(undefined),
);

mock.module("@tauri-apps/api/core", () => ({ ...tauriCore, invoke }));

const { CcSwitchSetupCard } = await import("../chat/CcSwitchSetupCard");
const { dict } = await import("../lib/i18n");

export { CcSwitchSetupCard, dict };

export const draft = {
  callID: "call-1",
  providerName: "YUME",
  baseUrl: "https://api.example.test/v1",
  modelHint: "model-a",
};

export const selection = {
  contractVersion: 1,
  selectionId: "selection-1",
  providerName: "YUME",
  endpoint: "https://api.example.test/v1",
  models: [
    { id: "model-a", name: "Model A" },
    { id: "model-b", name: "Model B" },
  ],
  expiresAt: 123,
};

export const prepared = {
  contractVersion: 1,
  receipt: {
    contractVersion: 1,
    ticketId: "ticket-1",
    providerName: "YUME",
    endpoint: "https://api.example.test/v1",
    selectedModel: "model-b",
    expiresAt: 123,
  },
  recovery: {
    snapshotId: "snapshot-1",
    original: {
      config: { kind: "present", sha256: "hash-before" },
      auth: { kind: "missing" },
    },
  },
};

export const currentFiles = {
  config: { kind: "present", sha256: "hash-after" },
  auth: { kind: "missing" },
};

export function installDefaultInvoke(): void {
  invoke.mockReset();
  invoke.mockImplementation((command: string, args?: unknown) => {
    switch (command) {
      case "ccswitch_capability_status":
        return Promise.resolve({ kind: "ready", version: "3.20.0" });
      case "prepare_ccswitch_opencode_provider":
        return Promise.resolve(selection);
      case "select_ccswitch_opencode_model":
        return Promise.resolve(prepared);
      case "launch_ccswitch_opencode_import":
        return Promise.resolve({ ...prepared.receipt, enabled: true });
      case "check_ccswitch_opencode_import":
        return Promise.resolve({
          kind: "verified",
          providerName: "YUME",
          modelId: "model-b",
          currentHash: "hash-after",
        });
      case "observe_ccswitch_opencode_files":
        return Promise.resolve(currentFiles);
      case "complete_ccswitch_recovery":
        return Promise.resolve(
          (args as { completion?: { kind?: string } } | undefined)?.completion?.kind ===
            "timedOut"
            ? "retained"
            : "destroyed",
        );
      default:
        return Promise.resolve(undefined);
    }
  });
}

export function renderCard(
  options: {
    readonly onClose?: () => void;
    readonly pollIntervalMs?: number;
    readonly externalWaitTimeoutMs?: number;
  } = {},
): void {
  render(
    <CcSwitchSetupCard
      t={dict("en-US")}
      draft={draft}
      onClose={options.onClose ?? (() => undefined)}
      pollIntervalMs={options.pollIntervalMs}
      externalWaitTimeoutMs={options.externalWaitTimeoutMs}
    />,
  );
}

export async function reachModelSelection(apiKey = "test-key"): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("API Key"), apiKey);
  await user.click(screen.getByRole("button", { name: "Validate and prepare" }));
  await screen.findByRole("combobox", { name: "Model" });
}

export async function reachDisclosure(): Promise<void> {
  await reachModelSelection();
  const user = userEvent.setup();
  await user.selectOptions(screen.getByRole("combobox", { name: "Model" }), "model-b");
  await user.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByText(/temporarily exposes the API key/i);
}

export async function launchFromDisclosure(): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Open CC Switch" }));
}
