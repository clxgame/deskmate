import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import * as tauriCore from "@tauri-apps/api/core";
import { isMediaFile, parseLocalResources, pickChatResources, prepareChatResources, readLegacyResource, stageMediaResource, stripLocalResourceContext, usesLegacyAttachment } from "./localResources";

const invoke = mock<(command: string, args?: unknown) => Promise<unknown>>(() => Promise.resolve([]));
let previousInvoke = tauriCore.invoke;

beforeEach(() => {
  invoke.mockReset();
  previousInvoke = tauriCore.invoke;
  mock.module("@tauri-apps/api/core", () => ({ ...tauriCore, invoke }));
});
afterEach(() => { mock.module("@tauri-apps/api/core", () => ({ ...tauriCore, invoke: previousInvoke })); });

const audio = { id: "resource_audio", name: "voice.mp3", kind: "audio", mime: "audio/mpeg", size: 42, previewUrl: "chat-resource://localhost/resource_audio" } as const;

describe("local resource boundaries", () => {
  test("recognizes mainstream media with missing MIME without routing documents as media", () => {
    for (const name of ["voice.MP3", "voice.wav", "voice.wave", "voice.m4a", "voice.aac", "voice.flac", "voice.ogg", "voice.opus", "voice.aiff", "voice.wma", "clip.mp4", "clip.mov", "clip.webm", "clip.mkv", "clip.avi", "clip.m4v"]) {
      expect(isMediaFile({ name, type: "" })).toBe(true);
    }
    expect(isMediaFile({ name: "extensionless", type: "audio/wav" })).toBe(true);
    expect(isMediaFile({ name: "notes.md", type: "text/markdown" })).toBe(false);
    expect(isMediaFile({ name: "locked.ncm", type: "application/octet-stream" })).toBe(false);
  });

  test("keeps directory metadata distinct from zero-byte files", () => {
    const [folder] = parseLocalResources([{ id: "resource_folder", name: "Audio", kind: "directory", mime: "application/x-directory", size: null, previewUrl: null }]);
    expect(folder).toMatchObject({ kind: "directory", size: null });
    expect(usesLegacyAttachment(folder)).toBe(false);
    expect(usesLegacyAttachment({ ...audio, kind: "file", name: "notes.md", mime: "text/markdown" })).toBe(true);
    expect(usesLegacyAttachment(audio)).toBe(false);
  });

  test("accepts only matching local preview URLs and strips native paths", () => {
    for (const previewUrl of ["chat-resource://localhost/resource_audio", "http://chat-resource.localhost/resource_audio", "https://chat-resource.localhost/resource_audio"]) {
      expect(parseLocalResources([{ ...audio, previewUrl }])[0].previewUrl).toBe(previewUrl);
    }
    for (const previewUrl of ["file:///Users/person/private.mp3", "https://untrusted.example/audio.mp3", "chat-resource://localhost/other", "chat-resource://localhost/resource_audio?path=/private"]) {
      expect(parseLocalResources([{ ...audio, previewUrl, path: "/private/source.mp3" }])[0]).toEqual({ ...audio, previewUrl: null });
    }
    expect(() => parseLocalResources([{ ...audio, id: "../private" }])).toThrow();
    expect(() => parseLocalResources([{ ...audio, name: "/private/source.mp3" }])).toThrow();
    expect(() => parseLocalResources([{ ...audio, size: -1 }])).toThrow();
  });

  test("picker returns metadata without copying media bytes", async () => {
    invoke.mockResolvedValue([audio]);
    expect(await pickChatResources("Choose files")).toEqual([audio]);
    expect(invoke.mock.calls).toEqual([["pick_chat_resources", { title: "Choose files", directory: false }]]);
  });

  test("browser audio uploads read bytes once, while over-limit files never cross IPC", async () => {
    invoke.mockResolvedValue(audio);
    const file = new File([new Uint8Array([82, 73, 70, 70])], "voice.wav", { type: "audio/wav" });
    expect(await stageMediaResource(file)).toEqual(audio);
    expect(invoke.mock.calls[0]).toEqual(["stage_chat_resource_upload", { fileName: "voice.wav", mime: "audio/wav", bytes: [82, 73, 70, 70] }]);
    const oversized = { name: "big.wav", size: 64 * 1024 * 1024 + 1, arrayBuffer: mock(() => Promise.resolve(new ArrayBuffer(0))) };
    await expect(stageMediaResource(oversized as unknown as File)).rejects.toThrow("resource_upload_size_limit");
    expect(oversized.arrayBuffer).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  test("legacy documents read separately and resource preparation sends IDs only", async () => {
    invoke.mockResolvedValueOnce({ fileName: "notes.md", base64: btoa("# notes") });
    const file = await readLegacyResource("resource_notes");
    expect(file.name).toBe("notes.md");
    expect(await file.text()).toBe("# notes");
    invoke.mockResolvedValueOnce({ parts: [], text: "native reference" });
    expect(await prepareChatResources(".", "ses-1", "msg-1", [audio.id])).toEqual({ parts: [], text: "native reference" });
    expect(invoke.mock.calls[1]).toEqual(["prepare_chat_resources", { directory: ".", sessionId: "ses-1", messageId: "msg-1", resourceIds: [audio.id] }]);
  });

  test("resource context stays out of displayed conversation text", () => {
    expect(stripLocalResourceContext("请转写\n\n<yume-local-resources>\n/private/audio.mp3\n</yume-local-resources>")).toBe("请转写");
    expect(stripLocalResourceContext("保留用户原文")).toBe("保留用户原文");
  });
});
