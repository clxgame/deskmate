import { describe, expect, test } from "bun:test";
import { initialUpdateState, reduceUpdateState } from "./updateState";

describe("one-click update state", () => {
  test("moves from checking to download progress", () => {
    // Given
    const checking = reduceUpdateState(initialUpdateState, { type: "check" });

    // When
    const downloading = reduceUpdateState(checking, {
      type: "downloadProgress",
      downloaded: 50,
      contentLength: 100,
    });

    // Then
    expect(downloading).toEqual({ kind: "downloading", percent: 50 });
  });

  test("keeps download progress indeterminate when total size is unknown", () => {
    // Given
    const checking = reduceUpdateState(initialUpdateState, { type: "check" });

    // When
    const downloading = reduceUpdateState(checking, {
      type: "downloadProgress",
      downloaded: 50,
      contentLength: null,
    });

    // Then
    expect(downloading).toEqual({ kind: "downloading", percent: null });
  });

  test("allows retry after an error", () => {
    // Given
    const failed = reduceUpdateState(initialUpdateState, {
      type: "fail",
      message: "failed",
    });

    // When
    const retrying = reduceUpdateState(failed, { type: "check" });

    // Then
    expect(retrying).toEqual({ kind: "checking" });
  });
});
