import { describe, expect, test } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  cleanupSessions,
  commands,
  consoleError,
  discardedIds,
  dropFiles,
  orderedEvents,
  promptRequests,
  readyComposer,
  setCleanupFails,
  setHistorySession,
  setPromptFails,
  stageSessionIds,
} from "./chatAttachmentLifecycleHarness.test";

const { default: ChatApp } = await import("./ChatApp");

describe("ChatApp attachment cache lifecycle", () => {
  test("cleans the previous session after reset abort without blocking the new session", async () => {
    setCleanupFails(true);
    render(<ChatApp />);
    await readyComposer();
    dropFiles([new File(["# a"], "a.md", { type: "text/markdown" })]);
    await waitFor(() => expect(stageSessionIds()).toEqual(["ses-a"]));

    fireEvent.click(screen.getByRole("button", { name: "历史" }));
    fireEvent.click(await screen.findByRole("button", { name: "+ 新会话" }));

    await waitFor(() => expect(orderedEvents()).toContain("abort:ses-a"));
    await waitFor(() => expect(cleanupSessions()).toEqual(["ses-a"]));
    expect(consoleError).toHaveBeenCalledTimes(1);
    dropFiles([new File(["# b"], "b.md", { type: "text/markdown" })]);
    await waitFor(() => expect(stageSessionIds()).toEqual(["ses-a", "ses-b"]));
  });

  test("cleans before a resumed session is used and does not resurrect artifact history", async () => {
    setHistorySession("hist-1", [{ role: "assistant", text: "生成的音频 song.mp3", time: 1 }]);
    render(<ChatApp />);
    await readyComposer();

    fireEvent.click(screen.getByRole("button", { name: "历史" }));
    fireEvent.click(await screen.findByRole("button", { name: /Past/ }));

    await waitFor(() => expect(cleanupSessions()).toEqual(["ses-a"]));
    expect(screen.queryByRole("article", { name: "生成的音频 song.mp3" })).toBeNull();
    dropFiles([new File(["# h"], "hist.md", { type: "text/markdown" })]);
    await waitFor(() => expect(stageSessionIds()).toEqual(["hist-1"]));
    expect(orderedEvents()).toEqual(["history_load:hist-1", "cleanup:ses-a", "stage:hist-1"]);
  });

  test("cleans a deleted history session through the typed delete callback", async () => {
    setHistorySession("hist-1", [{ role: "user", text: "old", time: 1 }]);
    render(<ChatApp />);
    await readyComposer();

    fireEvent.click(screen.getByRole("button", { name: "历史" }));
    await screen.findByRole("button", { name: /Past/ });
    fireEvent.click(screen.getByRole("button", { name: "删除" }));

    await waitFor(() => expect(commands("history_delete")).toHaveLength(1));
    await waitFor(() => expect(cleanupSessions()).toEqual(["hist-1"]));
  });

  test("hiding chat leaves the current cache untouched", async () => {
    render(<ChatApp />);
    await readyComposer();

    fireEvent.click(screen.getByRole("button", { name: "关闭" }));

    await waitFor(() => expect(commands("hide_chat")).toHaveLength(1));
    expect(cleanupSessions()).toEqual([]);
  });

  test("ordinary send discards staged sources only after the preview is rendered", async () => {
    render(<ChatApp />);
    const input = await readyComposer();
    dropFiles([new File(["# notes"], "notes.md", { type: "text/markdown" })]);
    await waitFor(() => expect(stageSessionIds()).toEqual(["ses-a"]));

    fireEvent.change(input, { target: { value: "请整理" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await screen.findByText("文档 · notes.md");
    await waitFor(() => expect(discardedIds()).toEqual(["stage-notes"]));
    expect(promptRequests[0]?.parts?.filter((part) => part.type === "file").map((part) => part.filename)).toEqual(["notes.md"]);
  });

  test("prompt failure keeps ordinary staged sources retryable", async () => {
    setPromptFails(true);
    render(<ChatApp />);
    const input = await readyComposer();
    dropFiles([new File(["# notes"], "notes.md", { type: "text/markdown" })]);
    await waitFor(() => expect(stageSessionIds()).toEqual(["ses-a"]));

    fireEvent.change(input, { target: { value: "请整理" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await screen.findByText("附件发送失败，请检查文件后重试");
    expect(discardedIds()).toEqual([]);
    expect(screen.getByRole("button", { name: "移除附件 notes.md" })).toBeDefined();
  });

  test("downloaded generated artifacts remain cached until a session cleanup", async () => {
    render(<ChatApp />);
    await readyComposer();
    dropFiles([new File(["ncm"], "song.ncm", { type: "application/octet-stream" })]);
    fireEvent.click(await screen.findByRole("button", { name: "转换" }));
    await screen.findByRole("article", { name: "生成的音频 song.mp3" });

    fireEvent.click(screen.getByRole("button", { name: "下载" }));

    await waitFor(() => expect(commands("export_chat_artifact")).toHaveLength(1));
    expect(discardedIds()).toEqual([]);
    expect(cleanupSessions()).toEqual([]);
    expect(screen.getByRole("article", { name: "生成的音频 song.mp3" })).toBeDefined();
  });
});
