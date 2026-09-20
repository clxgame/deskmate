import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { dict } from "../lib/i18n";
import type { UpdateEvent, UpdateOutcome, UpdateStatus } from "../lib/updater";
import { UpdateFooter } from "./UpdateFooter";

afterEach(cleanup);
const t = dict("zh-CN");
const repo = "clxgame/deskmate";

function services(
  outcome: UpdateOutcome = { status: "upToDate", currentVersion: "0.4.3" },
  status: UpdateStatus = { status: "idle" },
) {
  return {
    getAppVersion: mock(async () => "0.4.3"),
    getUpdateStatus: mock(async (): Promise<UpdateStatus> => status),
    updateApp: mock(async (_repo: string, _onEvent: (event: UpdateEvent) => void) => outcome),
    cancelUpdate: mock(async (): Promise<void> => undefined),
  };
}

describe("one-click Mac update", () => {
  test("one click checks, downloads, verifies, installs and restarts without another action", async () => {
    const api = services({ status: "installed", version: "0.4.4" });
    api.updateApp.mockImplementation(async (_repo, onEvent) => {
      onEvent({ event: "checking" });
      onEvent({ event: "downloadStarted", data: { version: "0.4.4", contentLength: 100 } });
      onEvent({ event: "downloadProgress", data: {
        version: "0.4.4", downloaded: 100, contentLength: 100,
      } });
      onEvent({ event: "verifying", data: { version: "0.4.4" } });
      onEvent({ event: "installing", data: { version: "0.4.4" } });
      onEvent({ event: "restarting", data: { version: "0.4.4" } });
      return { status: "installed", version: "0.4.4" };
    });
    render(<UpdateFooter repo={repo} t={t} services={api} />);
    fireEvent.click(screen.getByRole("button", { name: t.updateCheck }));
    await screen.findByText(t.updateRestarting);
    expect(api.updateApp).toHaveBeenCalledTimes(1);
    expect(api.updateApp.mock.calls[0]?.[0]).toBe(repo);
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  test("reports current version without downloading or restarting", async () => {
    const api = services();
    render(<UpdateFooter repo={repo} t={t} services={api} />);
    fireEvent.click(screen.getByRole("button", { name: t.updateCheck }));
    await screen.findByText(t.updateUpToDate);
    expect(api.updateApp).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  test("restores a backend update that is waiting for an active task", async () => {
    const api = services(undefined, { status: "waitingForIdle", version: "0.4.4" });
    render(<UpdateFooter repo={repo} t={t} services={api} />);
    await screen.findByText(t.updateWaitingForIdle);
    fireEvent.click(screen.getByRole("button", { name: t.updateCancelWait }));
    await waitFor(() => expect(api.cancelUpdate).toHaveBeenCalledTimes(1));
    expect(api.updateApp).not.toHaveBeenCalled();
  });

  test("prevents duplicate clicks while one update is pending", async () => {
    const api = services();
    let finish!: (outcome: UpdateOutcome) => void;
    api.updateApp.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    render(<UpdateFooter repo={repo} t={t} services={api} />);
    const button = screen.getByRole("button", { name: t.updateCheck });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(api.updateApp).toHaveBeenCalledTimes(1);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    finish({ status: "upToDate", currentVersion: "0.4.3" });
    await screen.findByText(t.updateUpToDate);
  });
});
