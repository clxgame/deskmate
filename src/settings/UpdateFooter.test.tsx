import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { dict } from "../lib/i18n";
import type { UpdateOutcome } from "../lib/updater";
import { UpdateFooter } from "./UpdateFooter";

afterEach(cleanup);
const t = dict("zh-CN");
const repo = "clxgame/deskmate";
const available = { status: "available", version: "0.3.20",
  downloadUrl: "https://github.com/clxgame/deskmate/releases/download/v0.3.20/YUME_0.3.20_aarch64.dmg" } as const;

function services(outcome: UpdateOutcome = available) {
  return {
    getAppVersion: mock(async () => "0.3.16"),
    updateApp: mock(async (): Promise<UpdateOutcome> => outcome),
    openUpdateDownload: mock(async (_repo: string, _url: string): Promise<void> => undefined),
  };
}

describe("Mac update check and download", () => {
  test("finds a release and opens its download only when requested", async () => {
    const api = services();
    render(<UpdateFooter repo={repo} t={t} services={api} />);
    fireEvent.click(screen.getByRole("button", { name: t.updateCheck }));
    const download = await screen.findByRole("button", { name: t.updateDownload });
    expect(screen.getByRole("status").textContent).toContain("v0.3.20");
    expect(api.openUpdateDownload).not.toHaveBeenCalled();
    fireEvent.click(download);
    await waitFor(() => expect(api.openUpdateDownload).toHaveBeenCalledWith(repo, available.downloadUrl));
    await waitFor(() => expect((download as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByRole("status").textContent).toContain(t.updateManualInstall);
    expect(screen.queryByText(t.updateUpdating)).toBeNull();
  });

  test("shows current version without a download action", async () => {
    const api = services({ status: "upToDate", currentVersion: "0.3.20" });
    render(<UpdateFooter repo={repo} t={t} services={api} />);
    fireEvent.click(screen.getByRole("button", { name: t.updateCheck }));
    await screen.findByText(t.updateUpToDate);
    expect(screen.queryByRole("button", { name: t.updateDownload })).toBeNull();
  });

  test("shows a missing platform distinctly and supports retry", async () => {
    const api = services();
    api.updateApp.mockRejectedValueOnce("platform_not_available");
    render(<UpdateFooter repo={repo} t={t} services={api} />);
    fireEvent.click(screen.getByRole("button", { name: t.updateCheck }));
    await screen.findByText(t.updatePlatformMissing);
    fireEvent.click(screen.getByRole("button", { name: t.updateCheck }));
    await screen.findByRole("button", { name: t.updateDownload });
    expect(api.updateApp).toHaveBeenCalledTimes(2);
  });

  test("keeps download available when the browser cannot open", async () => {
    const api = services();
    api.openUpdateDownload.mockRejectedValueOnce("open_failed");
    render(<UpdateFooter repo={repo} t={t} services={api} />);
    fireEvent.click(screen.getByRole("button", { name: t.updateCheck }));
    fireEvent.click(await screen.findByRole("button", { name: t.updateDownload }));
    await screen.findByText(t.updateOpenFailed);
    fireEvent.click(screen.getByRole("button", { name: t.updateDownload }));
    await waitFor(() => expect(api.openUpdateDownload).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText(t.updateOpenFailed)).toBeNull());
  });

  test("prevents duplicate checks while one is pending", async () => {
    const api = services();
    let finish!: (outcome: UpdateOutcome) => void;
    api.updateApp.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    render(<UpdateFooter repo={repo} t={t} services={api} />);
    const button = screen.getByRole("button", { name: t.updateCheck });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(api.updateApp).toHaveBeenCalledTimes(1);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    finish(available);
    await screen.findByRole("button", { name: t.updateDownload });
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });
});
