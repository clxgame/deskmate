import { describe, expect, test } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  commands,
  discardedIds,
  dropFiles,
  promptRequests,
  readyComposer,
  setConvertFails,
  setPromptFails,
} from "./chatAttachmentFlowHarness.test";

const { default: ChatApp } = await import("./ChatApp");

describe("ChatApp staged attachment flow", () => {
  test("creates a local artifact from dropped NCM only after explicit confirmation and download click", async () => {
    render(<ChatApp />);
    await readyComposer();

    dropFiles([new File(["ncm"], "locked.ncm", { type: "application/octet-stream" })]);

    await waitFor(() => expect(commands("stage_chat_attachment")).toHaveLength(1));
    expect(commands("convert_staged_ncm")).toHaveLength(0);
    expect(screen.getByRole("alertdialog", { name: "转换 NCM 音乐" })).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "转换" }));

    await waitFor(() => expect(commands("convert_staged_ncm")).toHaveLength(1));
    expect(await screen.findByRole("article", { name: "生成的音频 song.mp3" })).toBeDefined();
    expect(promptRequests).toHaveLength(0);
    expect(commands("export_chat_artifact")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "下载" }));

    await waitFor(() => expect(commands("export_chat_artifact")).toHaveLength(1));
  });

  test("keeps conversion retry local and never asks OpenCode to find the file", async () => {
    setConvertFails(true);
    render(<ChatApp />);
    await readyComposer();

    dropFiles([new File(["ncm"], "broken.ncm", { type: "application/octet-stream" })]);
    fireEvent.click(await screen.findByRole("button", { name: "转换" }));

    expect(await screen.findByRole("button", { name: "重试 broken.ncm" })).toBeDefined();
    expect(promptRequests).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "重试 broken.ncm" }));

    expect(await screen.findByRole("article", { name: "生成的音频 song.mp3" })).toBeDefined();
    expect(promptRequests).toHaveLength(0);
    expect(commands("convert_staged_ncm")).toHaveLength(2);
  });

  test("sends ordinary and mixed attachments to OpenCode with only model-ready files", async () => {
    render(<ChatApp />);
    const input = await readyComposer();

    dropFiles([
      new File(["# 计划"], "notes.md", { type: "text/markdown" }),
      new File(["ncm"], "locked.ncm", { type: "application/octet-stream" }),
    ]);
    await waitFor(() => expect(commands("stage_chat_attachment")).toHaveLength(2));
    await screen.findByRole("alertdialog", { name: "转换 NCM 音乐" });

    fireEvent.change(input, { target: { value: "请整理这份笔记" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(promptRequests).toHaveLength(1));
    const parts = promptRequests[0]?.parts ?? [];
    expect(parts[0]?.type).toBe("text");
    expect(parts.filter((part) => part.type === "file").map((part) => part.filename)).toEqual(["notes.md"]);
    expect(commands("convert_staged_ncm")).toHaveLength(0);
    expect(screen.getByRole("alertdialog", { name: "转换 NCM 音乐" })).toBeDefined();
  });

  test("discards staged ordinary sources after a successful prompt", async () => {
    render(<ChatApp />);
    await readyComposer();

    dropFiles([new File(["# 计划"], "notes.md", { type: "text/markdown" })]);
    await screen.findByText("notes.md");
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(promptRequests).toHaveLength(1));
    await waitFor(() => expect(discardedIds()).toEqual(["stage-notes"]));
    expect(screen.queryByText("notes.md")).toBeNull();
  });

  test("keeps staged ordinary sources retryable when prompt transport fails", async () => {
    setPromptFails(true);
    render(<ChatApp />);
    await readyComposer();

    dropFiles([new File(["# 计划"], "notes.md", { type: "text/markdown" })]);
    await screen.findByText("notes.md");
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(promptRequests).toHaveLength(1));
    await screen.findByRole("alert");
    expect(discardedIds()).toEqual([]);
    expect(screen.getByText("notes.md")).toBeDefined();
  });
});
