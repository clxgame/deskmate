import { describe, expect, test } from "bun:test";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { LocalResource } from "./localResources";
import { agentRun, ChatApp, deferResourcePreparation, dropNativeResources, finishResourcePreparation, invoke, promptRequests, registerChatAttachmentHarness, registerResource, selectWorkspace, setAttachmentPicker, setHistory, setMessageResources, setResourcePreparationError } from "./chatAttachmentSendHarness.test";

registerChatAttachmentHarness();

const resource = (id: string, name: string, kind: LocalResource["kind"], mime: string): LocalResource => ({ id, name, kind, mime, size: kind === "directory" ? null : 128, previewUrl: kind === "directory" ? null : `chat-resource://localhost/${id}` });
const audio = resource("native_audio", "voice.mp3", "audio", "audio/mpeg");
const folder = resource("native_folder", "Audio", "directory", "application/x-directory");

describe("native audio video and folder integration", () => {
  test("native drops show MP3 WAV M4A and video previews without byte-upload calls", async () => {
    render(<ChatApp />);
    await screen.findByPlaceholderText("输入消息,Enter 发送");
    const resources = [audio, resource("native_wav", "voice.wav", "audio", "audio/wav"), resource("native_m4a", "voice.m4a", "audio", "audio/mp4"), resource("native_video", "clip.mp4", "video", "video/mp4")];
    await act(async () => dropNativeResources(resources));
    for (const item of resources) {
      const preview = await screen.findByLabelText(`预览 ${item.name}`);
      expect(preview.tagName).toBe(item.kind === "video" ? "VIDEO" : "AUDIO");
      expect(preview.getAttribute("src")).toBe(item.previewUrl);
      expect(preview.getAttribute("preload")).toBe("metadata");
      expect(preview.hasAttribute("controls")).toBe(true);
    }
    expect(invoke.mock.calls.filter(([command]) => ["stage_chat_attachment", "read_chat_attachment", "stage_chat_resource_upload", "read_chat_resource_attachment"].includes(command))).toHaveLength(0);
  });

  test("folder drop lists entries and sends a directory reference without changing workspace", async () => {
    render(<ChatApp />);
    const input = await screen.findByPlaceholderText("输入消息,Enter 发送");
    await act(async () => dropNativeResources([folder]));
    const card = await screen.findByRole("article", { name: "Audio" });
    expect(card.textContent).not.toContain("0 B");
    fireEvent.click(screen.getByRole("button", { name: "查看内容 Audio" }));
    await screen.findByText("voice.wav");
    fireEvent.change(input, { target: { value: "列出这个文件夹" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(promptRequests).toHaveLength(1));
    expect(promptRequests[0].parts).toContainEqual({ type: "file", mime: "application/x-directory", filename: "Audio", url: "file:///fixture/Audio" });
    expect(invoke.mock.calls.some(([command]) => command === "agent_run_start")).toBe(false);
  });

  test("ordinary audio sends only references and retains a playable preview in the sent message", async () => {
    render(<ChatApp />);
    const input = await screen.findByPlaceholderText("输入消息,Enter 发送");
    await act(async () => dropNativeResources([audio]));
    await screen.findByLabelText("预览 voice.mp3");
    fireEvent.change(input, { target: { value: "将音频转换为 WAV" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(promptRequests).toHaveLength(1));
    expect(JSON.stringify(promptRequests[0])).not.toContain("base64");
    expect(promptRequests[0].parts?.some(part => part.type === "file" && part.mime?.startsWith("audio/"))).toBe(false);
    expect(invoke.mock.calls.find(([command]) => command === "prepare_chat_resources")?.[1]).toMatchObject({ resourceIds: [audio.id] });
    await waitFor(() => expect(screen.queryByRole("button", { name: "移除 voice.mp3" })).toBeNull());
    const preview = await screen.findByLabelText("预览 voice.mp3");
    expect(preview.closest(".chat-input-row")).toBeNull();
    expect(document.body.textContent).not.toContain("/fixture/voice.mp3");
  });

  test("native picker accepts audio in folder work and includes it in the Agent start request", async () => {
    selectWorkspace("C:\\workspace");
    setAttachmentPicker(async () => [registerResource(audio)]);
    render(<ChatApp />);
    const input = await screen.findByPlaceholderText("输入消息,Enter 发送");
    fireEvent.click(screen.getByRole("button", { name: "文件夹" }));
    await screen.findByText("workspace");
    const attach = screen.getByRole("button", { name: "附件" }) as HTMLButtonElement;
    expect(attach.disabled).toBe(false);
    fireEvent.click(attach);
    await screen.findByLabelText("预览 voice.mp3");
    fireEvent.change(input, { target: { value: "把这个音频复制到项目" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(invoke.mock.calls.some(([command]) => command === "agent_run_start")).toBe(true));
    expect(invoke.mock.calls.find(([command]) => command === "agent_run_start")?.[1]).toMatchObject({ request: { workspacePath: "C:\\workspace", input: "把这个音频复制到项目", resourceIds: [audio.id] } });
    expect(promptRequests).toHaveLength(0);
  });

  test("an unavailable original file keeps the draft and preview for retry without sending a false success", async () => {
    render(<ChatApp />);
    const input = await screen.findByPlaceholderText("输入消息,Enter 发送") as HTMLTextAreaElement;
    await act(async () => dropNativeResources([audio]));
    await screen.findByLabelText("预览 voice.mp3");
    setResourcePreparationError("resource_missing");
    fireEvent.change(input, { target: { value: "转写这段音频" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    expect((await screen.findByRole("alert")).textContent).toContain("原文件已移动");
    expect(input.value).toBe("转写这段音频");
    expect(screen.getByRole("button", { name: "移除 voice.mp3" })).toBeDefined();
    expect(promptRequests).toHaveLength(0);
    setResourcePreparationError(null);
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(promptRequests).toHaveLength(1));
  });

  test("an audio-only draft can be sent without typed text", async () => {
    render(<ChatApp />);
    await screen.findByPlaceholderText("输入消息,Enter 发送");
    await act(async () => dropNativeResources([audio]));
    const send = screen.getByRole("button", { name: "发送" }) as HTMLButtonElement;
    await waitFor(() => expect(send.disabled).toBe(false));
    fireEvent.click(send);
    await waitFor(() => expect(promptRequests).toHaveLength(1));
    expect(promptRequests[0].parts?.[0]?.text).toContain("voice.mp3");
    expect(JSON.stringify(promptRequests[0])).not.toContain("base64");
  });

  test("click and Enter cannot submit twice while native resources are being prepared", async () => {
    deferResourcePreparation();
    render(<ChatApp />);
    const input = await screen.findByPlaceholderText("输入消息,Enter 发送") as HTMLTextAreaElement;
    await act(async () => dropNativeResources([audio]));
    fireEvent.change(input, { target: { value: "转写一次" } });
    const send = screen.getByRole("button", { name: "发送" }) as HTMLButtonElement;
    fireEvent.click(send);
    await waitFor(() => expect(invoke.mock.calls.filter(([command]) => command === "prepare_chat_resources")).toHaveLength(1));
    expect(send.disabled).toBe(true);
    expect(input.disabled).toBe(true);
    for (const name of ["附件", "移除 voice.mp3"]) {
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
    }
    fireEvent.click(send);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(promptRequests).toHaveLength(0);
    expect(invoke.mock.calls.filter(([command]) => command === "prepare_chat_resources")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "文件夹" }));
    expect(screen.queryAllByRole("menuitem")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: /Claude Sonnet 4.5/ }));
    expect(screen.queryAllByRole("menuitemradio")).toHaveLength(0);
    await act(async () => finishResourcePreparation());
    await waitFor(() => expect(promptRequests).toHaveLength(1));
    expect(invoke.mock.calls.filter(([command]) => command === "prepare_chat_resources")).toHaveLength(1);
  });

  test("browser WAV drops use the media upload path and display audio controls", async () => {
    render(<ChatApp />);
    await screen.findByPlaceholderText("输入消息,Enter 发送");
    const root = document.querySelector(".chat-root");
    if (!root) throw new Error("chat root missing");
    fireEvent.drop(root, { dataTransfer: { files: [new File(["RIFF"], "recording.wav", { type: "audio/wav" })], types: ["Files"] } });
    await screen.findByLabelText("预览 recording.wav");
    expect(invoke.mock.calls.filter(([command]) => command === "stage_chat_resource_upload")).toHaveLength(1);
    expect(invoke.mock.calls.filter(([command]) => command === "stage_chat_attachment")).toHaveLength(0);
  });

  test("reopened workspace history looks up audio by native message ID when its text part ID differs", async () => {
    setHistory({ ses_media_history: {
      id: "ses_media_history", title: "音频工作历史", created: 1, updated: 2, originRunId: "run_audio",
      messages: [{ role: "user", text: "处理这段音频\n\n<yume-local-resources>\n/fixture/voice.mp3\n</yume-local-resources>", time: 1, messageId: "msg_audio", partId: "part_audio_text" }],
    } });
    setMessageResources("msg_audio", [audio]);
    render(<ChatApp />);
    await screen.findByPlaceholderText("输入消息,Enter 发送");
    fireEvent.click(screen.getByRole("button", { name: "历史" }));
    fireEvent.click(await screen.findByRole("button", { name: "打开 音频工作历史" }));
    await screen.findByText("处理这段音频");
    await screen.findByLabelText("预览 voice.mp3");
    expect(invoke.mock.calls.filter(([command]) => command === "get_chat_message_resources").map(([, args]) => args)).toContainEqual({ directory: agentRun.workspacePath, sessionId: "ses_media_history", messageId: "msg_audio" });
    expect(invoke.mock.calls.some(([command, args]) => command === "get_chat_message_resources" && (args as { messageId: string }).messageId === "part_audio_text")).toBe(false);
    expect(document.body.textContent).not.toContain("/fixture/voice.mp3");
    expect(screen.queryByRole("button", { name: "移除 voice.mp3" })).toBeNull();
  });
});
