import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import * as tauriCore from "@tauri-apps/api/core";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const invoke = mock<(command: string, args?: unknown) => Promise<unknown>>(
  () => Promise.resolve(undefined),
);

mock.module("@tauri-apps/api/core", () => ({ ...tauriCore, invoke }));

const { CcSwitchSetupCard } = await import("./CcSwitchSetupCard");
const { dict } = await import("../lib/i18n");

const draft = {
  callID: "call-1",
  providerName: "YUME",
  baseUrl: "https://api.example.test/v1",
  modelHint: "model-a",
};

const selection = {
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

const prepared = {
  contractVersion: 1,
  receipt: {
    contractVersion: 1,
    ticketId: "ticket-1",
    providerName: "YUME",
    endpoint: "https://api.example.test/v1",
    selectedModel: "model-b",
    preImportHash: "hash-before",
    expiresAt: 123,
  },
  models: selection.models,
  recovery: {
    snapshotId: "snapshot-1",
    original: {
      config: { kind: "present", sha256: "hash-before" },
      auth: { kind: "missing" },
    },
  },
};

const currentFiles = {
  config: { kind: "present", sha256: "hash-after" },
  auth: { kind: "missing" },
};

function renderCard(
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

async function reachModelSelection(apiKey = "test-key"): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("API Key"), apiKey);
  await user.click(screen.getByRole("button", { name: "Validate and prepare" }));
  await screen.findByRole("combobox", { name: "Model" });
}

async function reachDisclosure(): Promise<void> {
  await reachModelSelection();
  const user = userEvent.setup();
  await user.selectOptions(screen.getByRole("combobox", { name: "Model" }), "model-b");
  await user.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByText(/temporarily exposes the API key/i);
}

async function launchFromDisclosure(): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Open CC Switch" }));
}

beforeEach(() => {
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
});

afterEach(cleanup);

describe("CC Switch secure setup card", () => {
  test("renders the credential boundary accessibly in every supported locale", () => {
    for (const locale of ["zh-CN", "en-US", "ja-JP", "ko-KR"] as const) {
      const labels = dict(locale);
      render(<CcSwitchSetupCard t={labels} draft={draft} onClose={() => undefined} />);

      expect(
        screen.getByRole("region", { name: labels.ccSwitchSetupTitle }),
      ).toBeDefined();
      expect(screen.getByLabelText(labels.apiKey)).toBeDefined();
      expect(
        screen.getByRole("button", { name: labels.ccSwitchSetupValidate }),
      ).toBeDefined();

      cleanup();
    }
  });

  test("clears the uncontrolled password field before the native preparation resolves", async () => {
    let resolvePrepare: (value: unknown) => void = () => undefined;
    invoke.mockImplementation((command: string) => {
      if (command === "ccswitch_capability_status") {
        return Promise.resolve({ kind: "ready", version: "3.20.0" });
      }
      if (command === "prepare_ccswitch_opencode_provider") {
        return new Promise((resolve) => {
          resolvePrepare = resolve;
        });
      }
      return Promise.resolve(undefined);
    });
    renderCard();
    const user = userEvent.setup();
    const password = screen.getByLabelText("API Key") as HTMLInputElement;
    const runtimeCanary = `card-${crypto.randomUUID()}`;

    await user.type(password, runtimeCanary);
    await user.click(screen.getByRole("button", { name: "Validate and prepare" }));

    expect(password.value).toBe("");
    expect(
      invoke.mock.calls.filter(([command]) => command === "prepare_ccswitch_opencode_provider"),
    ).toHaveLength(1);
    expect(
      invoke.mock.calls.find(([command]) => command === "prepare_ccswitch_opencode_provider")?.[1],
    ).toEqual({
      input: {
        providerName: "YUME",
        endpoint: "https://api.example.test/v1",
        apiKey: runtimeCanary,
      },
    });
    resolvePrepare(selection);

    expect(await screen.findByRole("combobox", { name: "Model" })).toBeDefined();
    expect(screen.queryByText(runtimeCanary)).toBeNull();
  });

  test("creates the launch ticket from the native selection without resending key, catalog, or hash", async () => {
    renderCard();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("API Key"), "test-key");
    const submit = screen.getByRole("button", { name: "Validate and prepare" });

    await Promise.all([user.click(submit), user.click(submit)]);
    await waitFor(() => {
      expect(
        invoke.mock.calls.filter(([command]) => command === "prepare_ccswitch_opencode_provider"),
      ).toHaveLength(1);
    });

    const model = await screen.findByRole("combobox", { name: "Model" });
    await user.selectOptions(model, "model-a");
    await Promise.all([
      user.click(screen.getByRole("button", { name: "Continue" })),
      user.click(screen.getByRole("button", { name: "Continue" })),
    ]);
    await waitFor(() => {
      expect(
        invoke.mock.calls.filter(([command]) => command === "select_ccswitch_opencode_model"),
      ).toEqual([
        [
          "select_ccswitch_opencode_model",
          { input: { selectionId: "selection-1", selectedModel: "model-a" } },
        ],
      ]);
    });
    expect(screen.getByText(/temporarily exposes the API key/i)).toBeDefined();
    expect(
      invoke.mock.calls.some(([command]) => command === "launch_ccswitch_opencode_import"),
    ).toBe(false);
  });

  test("cancels the native selection when the card unmounts", async () => {
    renderCard();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("API Key"), "test-key");
    await user.click(screen.getByRole("button", { name: "Validate and prepare" }));
    await screen.findByRole("button", { name: "Continue" });

    cleanup();

    await waitFor(() => {
      expect(
        invoke.mock.calls.some(
          ([command, args]) =>
            command === "cancel_ccswitch_setup" &&
            (args as { handleId?: string }).handleId === "selection-1",
        ),
      ).toBe(true);
    });
  });

  test("uses a password field with browser credential persistence disabled", () => {
    renderCard();
    const password = screen.getByLabelText("API Key") as HTMLInputElement;

    expect(password.type).toBe("password");
    expect(password.autocomplete).toBe("off");
    expect(password.getAttribute("spellcheck")).toBe("false");
    expect(screen.getByText("Enter setup details")).toBeDefined();
  });

  test("supports keyboard submission and keyboard model confirmation", async () => {
    renderCard();
    const user = userEvent.setup();
    const password = screen.getByLabelText("API Key");
    await user.type(password, "keyboard-test-key{Enter}");

    const model = await screen.findByRole("combobox", { name: "Model" });
    await user.selectOptions(model, "model-b");
    screen.getByRole("button", { name: "Continue" }).focus();
    await user.keyboard("{Enter}");

    expect(await screen.findByText(/temporarily exposes the API key/i)).toBeDefined();
  });

  test("shows unavailable and localized invalid-key states without echoing the credential", async () => {
    invoke.mockImplementation((command: string) => {
      if (command === "ccswitch_capability_status") {
        return Promise.resolve({ kind: "unavailable", reason: "not-installed" });
      }
      return Promise.resolve(undefined);
    });
    renderCard();
    expect(await screen.findByText("Unavailable")).toBeDefined();
    cleanup();

    const rejected = `rejected-${crypto.randomUUID()}`;
    invoke.mockImplementation((command: string) => {
      if (command === "ccswitch_capability_status") {
        return Promise.resolve({ kind: "ready", version: "3.20.0" });
      }
      if (command === "prepare_ccswitch_opencode_provider") {
        return Promise.reject({ code: "ccswitch_invalid_api_key" });
      }
      return Promise.resolve(undefined);
    });
    renderCard();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("API Key"), rejected);
    await user.click(screen.getByRole("button", { name: "Validate and prepare" }));

    expect(await screen.findByText("Validation failed")).toBeDefined();
    expect(screen.getByText("The API key was rejected.")).toBeDefined();
    expect(document.body.innerHTML).not.toContain(rejected);
  });

  test("shows validating, model-ready, disclosure, launching, and waiting states in order", async () => {
    let resolveValidation: (value: unknown) => void = () => undefined;
    let resolveLaunch: (value: unknown) => void = () => undefined;
    invoke.mockImplementation((command: string) => {
      switch (command) {
        case "ccswitch_capability_status":
          return Promise.resolve({ kind: "ready", version: "3.20.0" });
        case "prepare_ccswitch_opencode_provider":
          return new Promise((resolve) => {
            resolveValidation = resolve;
          });
        case "select_ccswitch_opencode_model":
          return Promise.resolve(prepared);
        case "launch_ccswitch_opencode_import":
          return new Promise((resolve) => {
            resolveLaunch = resolve;
          });
        case "check_ccswitch_opencode_import":
          return new Promise(() => undefined);
        default:
          return Promise.resolve(undefined);
      }
    });
    renderCard();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("API Key"), "state-test-key");
    await user.click(screen.getByRole("button", { name: "Validate and prepare" }));
    expect(screen.getByText("Validating")).toBeDefined();

    resolveValidation(selection);
    expect(await screen.findByText("Model ready")).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("Confirmation required")).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Open CC Switch" }));
    expect(screen.getByText("Opening CC Switch")).toBeDefined();
    resolveLaunch({ ...prepared.receipt, enabled: true });
    expect(await screen.findByText("Waiting for CC Switch import")).toBeDefined();
  });

  test("does not treat launch as success and verifies only after external polling", async () => {
    let checks = 0;
    invoke.mockImplementation((command: string) => {
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
          checks += 1;
          return Promise.resolve(
            checks === 1
              ? { kind: "pending", currentHash: "hash-before" }
              : {
                  kind: "verified",
                  providerName: "YUME",
                  modelId: "model-b",
                  currentHash: "hash-after",
                },
          );
        case "complete_ccswitch_recovery":
          return Promise.resolve("destroyed");
        default:
          return Promise.resolve(undefined);
      }
    });
    renderCard({ pollIntervalMs: 1 });
    await reachDisclosure();
    await launchFromDisclosure();

    expect(await screen.findByText("Import verified")).toBeDefined();
    expect(checks).toBe(2);
    expect(invoke).toHaveBeenCalledWith("complete_ccswitch_recovery", {
      completion: { snapshotId: "snapshot-1", kind: "verified" },
    });
  });

  test("times out, retains recoverability, and requires explicit discard confirmation", async () => {
    const onClose = mock(() => undefined);
    renderCard({ onClose, externalWaitTimeoutMs: 0 });
    await reachDisclosure();
    await launchFromDisclosure();

    expect(await screen.findByText("Timed out")).toBeDefined();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Keep current state" }));
    expect(screen.getByText("Confirm keeping current state")).toBeDefined();
    expect(screen.getByText(/permanently deletes the encrypted recovery snapshot/i)).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Keep current state" }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("discard_ccswitch_recovery", {
        snapshotId: "snapshot-1",
        confirmed: true,
      });
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  test("surfaces changed-invalid and generic read-failure states", async () => {
    invoke.mockImplementation((command: string) => {
      if (command === "ccswitch_capability_status") {
        return Promise.resolve({ kind: "ready", version: "3.20.0" });
      }
      if (command === "prepare_ccswitch_opencode_provider") return Promise.resolve(selection);
      if (command === "select_ccswitch_opencode_model") return Promise.resolve(prepared);
      if (command === "launch_ccswitch_opencode_import") {
        return Promise.resolve({ ...prepared.receipt, enabled: true });
      }
      if (command === "check_ccswitch_opencode_import") {
        return Promise.resolve({ kind: "changedInvalid", reason: "modelMissing" });
      }
      if (command === "observe_ccswitch_opencode_files") return Promise.resolve(currentFiles);
      if (command === "complete_ccswitch_recovery") return Promise.resolve("retained");
      return Promise.resolve(undefined);
    });
    renderCard();
    await reachDisclosure();
    await launchFromDisclosure();
    expect(await screen.findByText("Unexpected external change")).toBeDefined();
    expect(screen.getByText(/target model is not active/i)).toBeDefined();
    cleanup();

    invoke.mockImplementation((command: string) => {
      if (command === "ccswitch_capability_status") {
        return Promise.resolve({ kind: "ready", version: "3.20.0" });
      }
      if (command === "prepare_ccswitch_opencode_provider") return Promise.resolve(selection);
      if (command === "select_ccswitch_opencode_model") return Promise.resolve(prepared);
      if (command === "launch_ccswitch_opencode_import") {
        return Promise.resolve({ ...prepared.receipt, enabled: true });
      }
      if (command === "check_ccswitch_opencode_import") {
        return Promise.resolve({ kind: "readFailure" });
      }
      if (command === "complete_ccswitch_recovery") return Promise.resolve("retained");
      return Promise.resolve(undefined);
    });
    renderCard();
    await reachDisclosure();
    await launchFromDisclosure();
    expect(await screen.findByText("Setup failed")).toBeDefined();
    expect(screen.getByText("Setup did not finish. Restore and try again.")).toBeDefined();
  });

  test("requires restore confirmation and reports stale conflicts", async () => {
    invoke.mockImplementation((command: string) => {
      if (command === "ccswitch_capability_status") {
        return Promise.resolve({ kind: "ready", version: "3.20.0" });
      }
      if (command === "prepare_ccswitch_opencode_provider") return Promise.resolve(selection);
      if (command === "select_ccswitch_opencode_model") return Promise.resolve(prepared);
      if (command === "launch_ccswitch_opencode_import") {
        return Promise.resolve({ ...prepared.receipt, enabled: true });
      }
      if (command === "check_ccswitch_opencode_import") {
        return Promise.resolve({ kind: "changedInvalid", reason: "providerMissing" });
      }
      if (command === "observe_ccswitch_opencode_files") return Promise.resolve(currentFiles);
      if (command === "complete_ccswitch_recovery") return Promise.resolve("retained");
      if (command === "restore_ccswitch_recovery") {
        return Promise.reject({ code: "ccswitch_recovery_stale_conflict" });
      }
      return Promise.resolve(undefined);
    });
    renderCard();
    await reachDisclosure();
    await launchFromDisclosure();
    await screen.findByText("Unexpected external change");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Restore previous config" }));
    expect(screen.getByText("Confirm restore")).toBeDefined();
    expect(screen.getByText(/overwrites the current OpenCode configuration files/i)).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Restore previous config" }));

    expect(await screen.findByText("Restore conflict")).toBeDefined();
    expect(screen.getByText(/files changed again/i)).toBeDefined();
  });

  test("cancels a prepared ticket and clears the local card state", async () => {
    renderCard();
    await reachDisclosure();
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: dict("en-US").memorySensitiveCancel }),
    );

    expect(await screen.findByText("Cancelled")).toBeDefined();
    expect(screen.getByText("Secure setup was cancelled.")).toBeDefined();
    expect(invoke).toHaveBeenCalledWith("cancel_ccswitch_setup", {
      handleId: "ticket-1",
    });
  });

  test("keeps the runtime canary out of DOM snapshots and every post-validation invocation", async () => {
    const canary = `runtime-canary-${crypto.randomUUID()}`;
    renderCard();
    await reachModelSelection(canary);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByRole("combobox", { name: "Model" }), "model-b");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    const htmlSnapshot = document.body.innerHTML;
    const nativeBoundaryIndex = invoke.mock.calls.findIndex(
      ([command]) => command === "prepare_ccswitch_opencode_provider",
    );
    const postBoundaryCalls = invoke.mock.calls.slice(nativeBoundaryIndex + 1);
    expect(htmlSnapshot).not.toContain(canary);
    expect(JSON.stringify(postBoundaryCalls)).not.toContain(canary);
  });
});
