import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import * as tauriCore from "@tauri-apps/api/core";
import * as tauriEvent from "@tauri-apps/api/event";
import type { LocalResource } from "./localResources";
import { useLocalResources } from "./useLocalResources";

const invoke = mock<(command: string, args?: unknown) => Promise<unknown>>(() => Promise.resolve([]));
const listeners = new Map<string, (event: { payload: unknown }) => void>();
const onLegacyFiles = mock<(files: readonly File[]) => void>(() => {});
const onError = mock<(error: string) => void>(() => {});
let controller: ReturnType<typeof useLocalResources>;
let previousInvoke = tauriCore.invoke;
let previousListen = tauriEvent.listen;
let previousEmit = tauriEvent.emit;

function Harness({ scopeKey = "ordinary", active = true, useLegacyFiles = true }: { scopeKey?: string; active?: boolean; useLegacyFiles?: boolean }) {
  controller = useLocalResources({ scopeKey, active, useLegacyFiles, onLegacyFiles, onError });
  return null;
}

const resource = (id: string, name: string, kind: LocalResource["kind"]): LocalResource => ({ id, name, kind, mime: kind === "directory" ? "application/x-directory" : kind === "audio" ? "audio/mpeg" : "video/mp4", size: kind === "directory" ? null : 100, previewUrl: kind === "directory" ? null : `chat-resource://localhost/${id}` });
const audio = resource("res_audio", "voice.mp3", "audio");
const folder = resource("res_folder", "Audio", "directory");

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation(() => Promise.resolve([]));
  onLegacyFiles.mockClear();
  onError.mockClear();
  listeners.clear();
  previousInvoke = tauriCore.invoke;
  previousListen = tauriEvent.listen;
  previousEmit = tauriEvent.emit;
  mock.module("@tauri-apps/api/core", () => ({ ...tauriCore, invoke }));
  mock.module("@tauri-apps/api/event", () => ({
    ...tauriEvent,
    emit: () => Promise.resolve(),
    listen: (name: string, callback: (event: { payload: unknown }) => void) => {
      listeners.set(name, callback);
      return Promise.resolve(() => { if (listeners.get(name) === callback) listeners.delete(name); });
    },
  }));
});
afterEach(() => {
  cleanup();
  mock.module("@tauri-apps/api/core", () => ({ ...tauriCore, invoke: previousInvoke }));
  mock.module("@tauri-apps/api/event", () => ({ ...tauriEvent, listen: previousListen, emit: previousEmit }));
});

async function nativeDrop(resources: readonly LocalResource[]) {
  await act(async () => { listeners.get("chat-resources-dropped")?.({ payload: resources }); });
}

function discardedIds(): string[] {
  return invoke.mock.calls.filter(([command]) => command === "discard_chat_resources")
    .flatMap(([, args]) => (args as { resourceIds: string[] }).resourceIds);
}

describe("local resource acquisition", () => {
  test("native drops retain media and folders as references without loading their bytes", async () => {
    render(<Harness />);
    const resources = [audio, resource("res_wav", "recording.wav", "audio"), resource("res_m4a", "recording.m4a", "audio"), resource("res_video", "clip.mp4", "video"), folder];
    await nativeDrop(resources);
    expect(controller.resources).toEqual(resources);
    expect(invoke).not.toHaveBeenCalled();
    expect(onLegacyFiles).not.toHaveBeenCalled();
    await nativeDrop([audio]);
    expect(controller.resources).toHaveLength(5);
  });

  test("native text documents keep the existing pipeline in chat and become references in workspace tasks", async () => {
    invoke.mockResolvedValue({ fileName: "notes.md", base64: btoa("# notes") });
    const notes = { ...resource("res_notes", "notes.md", "file"), mime: "text/markdown" };
    const view = render(<Harness />);
    await nativeDrop([notes, audio]);
    expect(controller.resources).toEqual([audio]);
    expect(onLegacyFiles).toHaveBeenCalledTimes(1);
    expect(await onLegacyFiles.mock.calls[0][0][0].text()).toBe("# notes");
    view.rerender(<Harness scopeKey="workspace" useLegacyFiles={false} />);
    await nativeDrop([notes]);
    expect(controller.resources).toEqual([notes]);
    expect(invoke.mock.calls.filter(([command]) => command === "read_chat_resource_attachment")).toHaveLength(1);
    expect(discardedIds()).toContain(notes.id);
  });

  test("a picker result cannot enter a new conversation and duplicate picker clicks are ignored", async () => {
    let resolve!: (value: unknown) => void;
    invoke.mockImplementation(command => command === "discard_chat_resources" ? Promise.resolve() : new Promise(done => { resolve = done; }));
    const view = render(<Harness />);
    let pending!: Promise<void>;
    await act(async () => { pending = controller.pick("选择文件"); void controller.pick("选择文件"); });
    expect(controller.pending).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(1);
    view.rerender(<Harness scopeKey="new-conversation" />);
    await act(async () => { resolve([audio]); await pending; });
    expect(controller.resources).toEqual([]);
    expect(controller.pending).toBe(false);
    expect(discardedIds()).toEqual([audio.id]);
  });

  test("a late legacy read cannot stage into a switched conversation", async () => {
    let resolve!: (value: unknown) => void;
    invoke.mockImplementation(command => command === "discard_chat_resources" ? Promise.resolve() : new Promise(done => { resolve = done; }));
    const view = render(<Harness />);
    await nativeDrop([{ ...resource("res_notes", "notes.md", "file"), mime: "text/plain" }]);
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    view.rerender(<Harness scopeKey="new-conversation" />);
    await act(async () => { resolve({ fileName: "notes.md", base64: btoa("notes") }); });
    expect(onLegacyFiles).not.toHaveBeenCalled();
    expect(discardedIds()).toContain("res_notes");
  });

  test("a second native drop is retained while a document read is pending", async () => {
    let resolve!: (value: unknown) => void;
    invoke.mockImplementation(command => command === "discard_chat_resources" ? Promise.resolve() : new Promise(done => { resolve = done; }));
    render(<Harness />);
    await nativeDrop([{ ...resource("res_notes", "notes.md", "file"), mime: "text/plain" }]);
    expect(controller.pending).toBe(true);
    await nativeDrop([audio, folder]);
    expect(controller.resources).toEqual([audio, folder]);
    expect(controller.pending).toBe(true);
    await act(async () => { resolve({ fileName: "notes.md", base64: btoa("notes") }); });
    expect(controller.pending).toBe(false);
    expect(onLegacyFiles).toHaveBeenCalledTimes(1);
  });

  test("successful media in a mixed upload survives another file failing", async () => {
    invoke.mockResolvedValueOnce(audio).mockRejectedValueOnce(new Error("corrupt audio"));
    render(<Harness />);
    await act(async () => { await controller.addMediaFiles([new File(["one"], "one.mp3"), new File(["two"], "two.wav")]); });
    expect(controller.resources).toEqual([audio]);
    expect(onError).toHaveBeenCalledWith("corrupt audio");
    expect(controller.pending).toBe(false);
  });

  test("an upload failure from the previous conversation cannot show an error in the next", async () => {
    let reject!: (error: Error) => void;
    invoke.mockImplementation(command => command === "discard_chat_resources" ? Promise.resolve() : new Promise((_resolve, fail) => { reject = fail; }));
    const view = render(<Harness />);
    let pending!: Promise<void>;
    await act(async () => { pending = controller.addMediaFiles([new File(["one"], "one.mp3")]); });
    view.rerender(<Harness scopeKey="new-conversation" />);
    await act(async () => { reject(new Error("old error")); await pending; });
    expect(controller.resources).toEqual([]);
    expect(controller.pending).toBe(false);
    expect(onError).not.toHaveBeenCalled();
  });

  test("sending retains bound resources while removing discards only the selected draft", async () => {
    render(<Harness />);
    await nativeDrop([audio, folder]);
    act(() => controller.clearSent([audio.id]));
    expect(controller.resources).toEqual([folder]);
    expect(discardedIds()).toEqual([]);
    act(() => controller.remove(folder.id));
    expect(controller.resources).toEqual([]);
    expect(discardedIds()).toEqual([folder.id]);
  });

  test("inactive chat ignores drops and reports errors only after reactivation", async () => {
    const view = render(<Harness active={false} />);
    await nativeDrop([audio]);
    act(() => listeners.get("chat-resources-error")?.({ payload: "unreadable" }));
    expect(controller.resources).toEqual([]);
    expect(discardedIds()).toEqual([audio.id]);
    expect(onError).not.toHaveBeenCalled();
    view.rerender(<Harness />);
    act(() => listeners.get("chat-resources-error")?.({ payload: "unreadable" }));
    expect(onError).toHaveBeenCalledWith("unreadable");
  });

  test("scope changes and unmount discard only unbound draft references", async () => {
    const view = render(<Harness />);
    await nativeDrop([audio, folder]);
    act(() => controller.clearSent([audio.id]));
    view.rerender(<Harness scopeKey="next" />);
    expect(discardedIds()).toEqual([folder.id]);
    await nativeDrop([audio]);
    view.unmount();
    expect(discardedIds()).toEqual([folder.id, audio.id]);
  });

  test("failed legacy reads discard their native registration without creating a draft", async () => {
    invoke.mockImplementation(command => command === "discard_chat_resources" ? Promise.resolve() : Promise.reject(new Error("unreadable document")));
    render(<Harness />);
    await nativeDrop([{ ...resource("res_notes", "notes.md", "file"), mime: "text/plain" }]);
    expect(controller.resources).toEqual([]);
    expect(onLegacyFiles).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith("unreadable document");
    expect(discardedIds()).toEqual(["res_notes"]);
  });

  test("an upload that finishes after switching conversations is discarded", async () => {
    let resolve!: (value: unknown) => void;
    invoke.mockImplementation(command => command === "discard_chat_resources" ? Promise.resolve() : new Promise(done => { resolve = done; }));
    const view = render(<Harness />);
    let pending!: Promise<void>;
    await act(async () => { pending = controller.addMediaFiles([new File(["one"], "one.mp3")]); });
    view.rerender(<Harness scopeKey="next" />);
    await act(async () => { resolve(audio); await pending; });
    expect(controller.resources).toEqual([]);
    expect(discardedIds()).toEqual([audio.id]);
  });

  test("resource count overflow keeps the first 32 and discards only excess references", async () => {
    render(<Harness />);
    const resources = Array.from({ length: 33 }, (_, index) => resource(`res_${index}`, `clip-${index}.mp3`, "audio"));
    await nativeDrop(resources);
    expect(controller.resources).toEqual(resources.slice(0, 32));
    expect(discardedIds()).toEqual(["res_32"]);
    expect(onError).toHaveBeenCalledWith("resource_selection_too_many");
  });
});
