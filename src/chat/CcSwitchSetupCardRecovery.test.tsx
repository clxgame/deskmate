import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  currentFiles,
  dict,
  installDefaultInvoke,
  invoke,
  launchFromDisclosure,
  prepared,
  reachDisclosure,
  renderCard,
  selection,
} from "../testing/CcSwitchSetupCardHarness";

beforeEach(installDefaultInvoke);
afterEach(cleanup);

describe("CC Switch setup card recovery flow", () => {
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
    expect(screen.getByText(/will not remove the provider or database record inside CC Switch/i)).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Open CC Switch" }));
    expect(screen.getByText("Opening CC Switch")).toBeDefined();
    resolveLaunch({ ...prepared.receipt, enabled: true });
    expect(await screen.findByText("Waiting for CC Switch import")).toBeDefined();
  });

  test("does not treat launch as success and verifies only after external polling", async () => {
    let checks = 0;
    const onClose = mock(() => undefined);
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
              : { kind: "verified", providerName: "YUME", modelId: "model-b", currentHash: "hash-after" },
          );
        case "complete_ccswitch_recovery":
          return Promise.resolve("destroyed");
        default:
          return Promise.resolve(undefined);
      }
    });
    renderCard({ pollIntervalMs: 1, onClose });
    await reachDisclosure();
    await launchFromDisclosure();
    expect(await screen.findByText("Import verified")).toBeDefined();
    expect(checks).toBe(2);
    expect(invoke).toHaveBeenCalledWith("complete_ccswitch_recovery", {
      completion: { snapshotId: "snapshot-1", kind: "verified" },
    });
    const completedBeforeClose = invoke.mock.calls.filter(
      ([command]) => command === "complete_ccswitch_recovery",
    ).length;
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls.filter(([command]) => command === "complete_ccswitch_recovery")).toHaveLength(
      completedBeforeClose,
    );
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
      if (command === "ccswitch_capability_status") return Promise.resolve({ kind: "ready" });
      if (command === "prepare_ccswitch_opencode_provider") return Promise.resolve(selection);
      if (command === "select_ccswitch_opencode_model") return Promise.resolve(prepared);
      if (command === "launch_ccswitch_opencode_import") return Promise.resolve({ ...prepared.receipt, enabled: true });
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
      if (command === "ccswitch_capability_status") return Promise.resolve({ kind: "ready" });
      if (command === "prepare_ccswitch_opencode_provider") return Promise.resolve(selection);
      if (command === "select_ccswitch_opencode_model") return Promise.resolve(prepared);
      if (command === "launch_ccswitch_opencode_import") return Promise.resolve({ ...prepared.receipt, enabled: true });
      if (command === "check_ccswitch_opencode_import") return Promise.resolve({ kind: "readFailure" });
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
      if (command === "ccswitch_capability_status") return Promise.resolve({ kind: "ready" });
      if (command === "prepare_ccswitch_opencode_provider") return Promise.resolve(selection);
      if (command === "select_ccswitch_opencode_model") return Promise.resolve(prepared);
      if (command === "launch_ccswitch_opencode_import") return Promise.resolve({ ...prepared.receipt, enabled: true });
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
    expect(screen.getByText(/will not remove the provider or database record inside CC Switch/i)).toBeDefined();
    expect(screen.queryByRole("button", { name: dict("en-US").memorySensitiveCancel })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Restore previous config" }));
    expect(await screen.findByText("Restore conflict")).toBeDefined();
    expect(screen.getByText(/files changed again/i)).toBeDefined();
  });
});
