import { describe, expect, mock, test } from "bun:test";
import * as tauriCore from "@tauri-apps/api/core";

const invoke = mock<(command: string, args?: unknown) => Promise<unknown>>(
  async (command) => {
    if (command === "ccswitch_capability_status") {
      return { kind: "ready", version: "3.20.0" };
    }
    if (command === "prepare_ccswitch_opencode_provider") {
      return {
        contractVersion: 1,
        selectionId: "selection-1",
        providerName: "Provider",
        endpoint: "https://api.example.test",
        models: [{ id: "model-a", name: "Model A" }],
        expiresAt: 123,
      };
    }
    if (command === "select_ccswitch_opencode_model") {
      return {
        contractVersion: 1,
        receipt: {
          contractVersion: 1,
          ticketId: "ticket-1",
          providerName: "Provider",
          endpoint: "https://api.example.test",
          selectedModel: "model-a",
          preImportHash: "hash-before",
          expiresAt: 456,
        },
        models: [{ id: "model-a", name: "Model A" }],
        recovery: {
          snapshotId: "snapshot-1",
          original: {
            config: { kind: "present", sha256: "hash-before" },
            auth: { kind: "missing" },
          },
        },
      };
    }
    if (command === "launch_ccswitch_opencode_import") {
      return {
        contractVersion: 1,
        ticketId: "ticket-1",
        providerName: "Provider",
        endpoint: "https://api.example.test",
        selectedModel: "model-a",
        preImportHash: "hash-before",
        expiresAt: 123,
        enabled: true,
      };
    }
    return undefined;
  },
);

mock.module("@tauri-apps/api/core", () => ({ ...tauriCore, invoke }));

const {
  cancelCcSwitchSetup,
  getCcSwitchCapabilityStatus,
  launchCcSwitchOpenCodeImport,
  validateCcSwitchOpenCodeProvider,
  selectCcSwitchOpenCodeModel,
} = await import("./ccswitch");

describe("CC Switch Tauri wrappers", () => {
  test("reads capability status from the native command", async () => {
    await expect(getCcSwitchCapabilityStatus()).resolves.toEqual({
      kind: "ready",
      version: "3.20.0",
    });
    expect(invoke).toHaveBeenCalledWith("ccswitch_capability_status");
  });

  test("passes provider setup input only through the secure native boundary", async () => {
    const runtimeCredential = `runtime-${crypto.randomUUID()}`;

    await validateCcSwitchOpenCodeProvider({
      providerName: "Provider",
      endpoint: "https://api.example.test",
      apiKey: runtimeCredential,
    });

    expect(invoke).toHaveBeenCalledWith("prepare_ccswitch_opencode_provider", {
      input: {
        providerName: "Provider",
        endpoint: "https://api.example.test",
        apiKey: runtimeCredential,
      },
    });
  });

  test("turns a secret-free native selection into a launch ticket without resending catalog or key", async () => {
    await selectCcSwitchOpenCodeModel({
      selectionId: "selection-1",
      selectedModel: "model-a",
    });

    expect(invoke).toHaveBeenCalledWith("select_ccswitch_opencode_model", {
      input: {
        selectionId: "selection-1",
        selectedModel: "model-a",
      },
    });
  });

  test("launches only with an explicit disclosure flag and can cancel by ticket", async () => {
    await launchCcSwitchOpenCodeImport({
      ticketId: "ticket-1",
      providerName: "Provider",
      endpoint: "https://api.example.test",
      selectedModel: "model-a",
      preImportHash: "hash-before",
      switchImmediately: true,
      acceptedProcessArgumentDisclosure: true,
    });
    await cancelCcSwitchSetup("ticket-1");

    expect(invoke).toHaveBeenCalledWith("launch_ccswitch_opencode_import", {
      request: {
        ticketId: "ticket-1",
        providerName: "Provider",
        endpoint: "https://api.example.test",
        selectedModel: "model-a",
        preImportHash: "hash-before",
        switchImmediately: true,
        acceptedProcessArgumentDisclosure: true,
      },
    });
    expect(invoke).toHaveBeenCalledWith("cancel_ccswitch_setup", {
      handleId: "ticket-1",
    });
  });
});
