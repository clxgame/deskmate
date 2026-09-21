import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    checkUpdate: mock(async (_repo: string): Promise<string | null> => "0.4.4"),
    getUpdateStatus: mock(async (): Promise<UpdateStatus> => status),
    updateApp: mock(async (_repo: string, _onEvent: (event: UpdateEvent) => void) => outcome),
    cancelUpdate: mock(async (): Promise<void> => undefined),
  };
}

describe("conditional Windows and Mac update footer", () => {
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
    fireEvent.click(await screen.findByRole("button", { name: t.updateCheck }));
    await screen.findByText(t.updateRestarting);
    expect(api.updateApp).toHaveBeenCalledTimes(1);
    expect(api.updateApp.mock.calls[0]?.[0]).toBe(repo);
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  test("reports current version without downloading or restarting", async () => {
    const api = services();
    render(<UpdateFooter repo={repo} t={t} services={api} />);
    fireEvent.click(await screen.findByRole("button", { name: t.updateCheck }));
    await waitFor(() => expect(screen.queryByRole("button")).toBeNull());
    expect(api.updateApp).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status")).toBeNull();
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
    const button = await screen.findByRole("button", { name: t.updateCheck });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(api.updateApp).toHaveBeenCalledTimes(1);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    finish({ status: "upToDate", currentVersion: "0.4.3" });
    await waitFor(() => expect(screen.queryByRole("button")).toBeNull());
  });
});


test("background check stays version-only while pending, then shows only the download button", async () => {
  const api = services();
  let resolve!: (version: string | null) => void;
  api.checkUpdate.mockImplementation(() => new Promise((done) => { resolve = done; }));
  render(<UpdateFooter repo={repo} t={t} services={api} />);
  await screen.findByText("v0.4.3");
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.queryByRole("status")).toBeNull();
  await act(async () => resolve("0.4.4"));
  await screen.findByRole("button", { name: "下载更新" });
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.queryByText(t.updateHint)).toBeNull();
  expect(api.checkUpdate).toHaveBeenCalledWith(repo);
  expect(api.updateApp).not.toHaveBeenCalled();
});

for (const scenario of ["current", "offline", "missing repository"]) {
  test(`only version remains for ${scenario}`, async () => {
    const api = services();
    api.checkUpdate.mockImplementation(async () => {
      if (scenario === "offline") throw new Error("network");
      return null;
    });
    render(<UpdateFooter repo={scenario === "missing repository" ? "" : repo} t={t} services={api} />);
    await screen.findByText("v0.4.3");
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("contentinfo").textContent).toBe("v0.4.3");
    expect(api.updateApp).not.toHaveBeenCalled();
    expect(api.checkUpdate).toHaveBeenCalledTimes(scenario === "missing repository" ? 0 : 1);
  });
}

test("reconnecting retries a failed background check without starting a download", async () => {
  const api = services();
  api.checkUpdate.mockRejectedValueOnce(new Error("network"));
  render(<UpdateFooter repo={repo} t={t} services={api} />);
  await screen.findByText("v0.4.3");
  fireEvent(window, new Event("online"));
  await screen.findByRole("button", { name: t.updateCheck });
  expect(api.checkUpdate).toHaveBeenCalledTimes(2);
  expect(api.updateApp).not.toHaveBeenCalled();
});

test("a stale repository response cannot reveal the old repository update", async () => {
  const api = services();
  let resolve!: (version: string | null) => void;
  api.checkUpdate.mockImplementation((value) => value === repo
    ? new Promise((done) => { resolve = done; }) : Promise.resolve(null));
  const view = render(<UpdateFooter repo={repo} t={t} services={api} />);
  view.rerender(<UpdateFooter repo="example/other" t={t} services={api} />);
  await act(async () => resolve("0.4.4"));
  await screen.findByText("v0.4.3");
  expect(screen.queryByRole("button")).toBeNull();
  expect(api.checkUpdate).toHaveBeenCalledWith("example/other");
});

test("download failure keeps an explicit retry available", async () => {
  const api = services();
  api.updateApp.mockRejectedValueOnce(new Error("network"));
  render(<UpdateFooter repo={repo} t={t} services={api} />);
  fireEvent.click(await screen.findByRole("button", { name: t.updateCheck }));
  await screen.findByRole("status");
  const button = screen.getByRole("button", { name: t.updateCheck });
  expect((button as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(button);
  await waitFor(() => expect(api.updateApp).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByRole("button")).toBeNull());
});

test("an idle status requested before a click cannot overwrite download progress", async () => {
  const api = services();
  let resolveStatus!: (status: UpdateStatus) => void;
  api.getUpdateStatus.mockImplementation(() => new Promise((done) => { resolveStatus = done; }));
  api.updateApp.mockImplementation(async (_repo, onEvent) => {
    onEvent({ event: "downloadProgress", data: { version: "0.4.4", downloaded: 50, contentLength: 100 } });
    return new Promise(() => {});
  });
  render(<UpdateFooter repo={repo} t={t} services={api} />);
  fireEvent.click(await screen.findByRole("button", { name: t.updateCheck }));
  await act(async () => resolveStatus({ status: "idle" }));
  expect(screen.getByRole("status").textContent).toContain("50%");
});
