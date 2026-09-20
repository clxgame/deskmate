import { describe, expect, test } from "bun:test";
import { initialUpdateState, reduceUpdateState } from "./updateState";

describe("one-click update state", () => {
  test("moves through download, verification, installation and restart", () => {
    const downloading = reduceUpdateState(initialUpdateState, {
      type: "download", version: "0.4.4", downloaded: 50, contentLength: 100,
    });
    expect(downloading).toEqual({ kind: "downloading", version: "0.4.4", percent: 50 });
    const verifying = reduceUpdateState(downloading, { type: "verify", version: "0.4.4" });
    expect(verifying).toEqual({ kind: "verifying", version: "0.4.4" });
    const installing = reduceUpdateState(verifying, { type: "install", version: "0.4.4" });
    expect(installing).toEqual({ kind: "installing", version: "0.4.4" });
    expect(reduceUpdateState(installing, { type: "restart", version: "0.4.4" }))
      .toEqual({ kind: "restarting", version: "0.4.4" });
  });

  test("keeps download progress indeterminate when total size is unknown", () => {
    expect(reduceUpdateState(initialUpdateState, {
      type: "download", version: "0.4.4", downloaded: 50, contentLength: null,
    })).toEqual({ kind: "downloading", version: "0.4.4", percent: null });
  });

  test("wait cancellation does not create a second install confirmation", () => {
    const waiting = reduceUpdateState(initialUpdateState, { type: "wait", version: "0.4.4" });
    expect(reduceUpdateState(waiting, { type: "cancelWait" }))
      .toEqual({ kind: "waitingForIdle", version: "0.4.4", canceling: true });
  });

  test("allows retry after an error", () => {
    const failed = reduceUpdateState(initialUpdateState, { type: "fail", message: "failed" });
    expect(reduceUpdateState(failed, { type: "check" })).toEqual({ kind: "checking" });
  });
});
