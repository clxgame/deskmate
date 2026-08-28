import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  currentFiles,
  dict,
  installDefaultInvoke,
  invoke,
  prepared,
  reachDisclosure,
  reachModelSelection,
  renderCard,
} from "../testing/CcSwitchSetupCardHarness";

beforeEach(installDefaultInvoke);
afterEach(cleanup);

describe("CC Switch setup card security boundaries", () => {
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

  test("unmounting a prepared card cancels its ticket and recovery without echoing the key", async () => {
    const canary = `unmount-${crypto.randomUUID()}`;
    renderCard();
    await reachModelSelection(canary);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByRole("combobox", { name: "Model" }), "model-b");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText(/temporarily exposes the API key/i);
    const nativeBoundaryIndex = invoke.mock.calls.findIndex(
      ([command]) => command === "prepare_ccswitch_opencode_provider",
    );
    expect(document.body.innerHTML).not.toContain(canary);
    cleanup();
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("cancel_ccswitch_setup", { handleId: "ticket-1" });
      expect(invoke).toHaveBeenCalledWith("observe_ccswitch_opencode_files");
      expect(invoke).toHaveBeenCalledWith("complete_ccswitch_recovery", {
        completion: { snapshotId: "snapshot-1", kind: "cancelled", observed: currentFiles },
      });
    });
    expect(JSON.stringify(invoke.mock.calls.slice(nativeBoundaryIndex + 1))).not.toContain(canary);
  });

  test("uses a password field with browser credential persistence disabled", () => {
    renderCard();
    const password = screen.getByLabelText("API Key") as HTMLInputElement;
    expect(password.type).toBe("password");
    expect(password.autocomplete).toBe("off");
    expect(password.getAttribute("spellcheck")).toBe("false");
    expect(screen.getByText("Enter setup details")).toBeDefined();
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
      if (command === "ccswitch_capability_status") return Promise.resolve({ kind: "ready" });
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

  test("keeps the runtime canary out of DOM snapshots and every post-validation invocation", async () => {
    const canary = `runtime-canary-${crypto.randomUUID()}`;
    renderCard();
    await reachModelSelection(canary);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByRole("combobox", { name: "Model" }), "model-b");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    const nativeBoundaryIndex = invoke.mock.calls.findIndex(
      ([command]) => command === "prepare_ccswitch_opencode_provider",
    );
    expect(document.body.innerHTML).not.toContain(canary);
    expect(JSON.stringify(invoke.mock.calls.slice(nativeBoundaryIndex + 1))).not.toContain(canary);
  });

  test("cancels a prepared ticket with CC Switch copy, not memory copy", async () => {
    renderCard();
    await reachDisclosure();
    const user = userEvent.setup();
    expect(screen.queryByRole("button", { name: dict("en-US").memorySensitiveCancel })).toBeNull();
    await user.click(screen.getByRole("button", { name: dict("en-US").ccSwitchSetupCancel }));
    expect(await screen.findByText("Cancelled")).toBeDefined();
    expect(screen.getByText("Secure setup was cancelled.")).toBeDefined();
    expect(invoke).toHaveBeenCalledWith("cancel_ccswitch_setup", {
      handleId: prepared.receipt.ticketId,
    });
  });
});
