import { describe, expect, test } from "bun:test";
import {
  cleanupChatSession,
  convertStagedNcm,
  discardChatAttachment,
  exportChatArtifact,
  readChatAttachment,
  stageChatAttachment,
  type AttachmentHost,
} from "./attachmentApi";

class FakeAttachmentHost implements AttachmentHost {
  readonly calls: Array<{
    readonly command: string;
    readonly payload: unknown;
  }> = [];

  constructor(private readonly responses: readonly unknown[]) {}

  async invoke(command: string, payload: unknown): Promise<unknown> {
    this.calls.push({ command, payload });
    const response = this.responses[this.calls.length - 1];
    if (response instanceof Error) throw response;
    return response;
  }
}

describe("attachment api", () => {
  test("stages_chat_attachment_when_host_returns_typed_artifact", async () => {
    // Given: a fake host returns the native stage response shape.
    const host = new FakeAttachmentHost([
      {
        id: "att-1",
        sessionId: "ses-1",
        fileName: "note.txt",
        mime: "text/plain",
        size: 12,
        kind: "text",
        status: "staged",
      },
    ]);

    // When: the frontend stages bytes through the injectable API.
    const result = await stageChatAttachment(
      {
        sessionId: "ses-1",
        fileName: "note.txt",
        mime: "text/plain",
        size: 12,
        bytes: [104, 101, 108, 108, 111],
      },
      host,
    );

    // Then: the command and payload are exact and no native path is exposed.
    expect(host.calls).toEqual([
      {
        command: "stage_chat_attachment",
        payload: {
          request: {
            sessionId: "ses-1",
            fileName: "note.txt",
            mime: "text/plain",
            size: 12,
            bytes: [104, 101, 108, 108, 111],
          },
        },
      },
    ]);
    expect(result).toEqual({
      id: "att-1",
      sessionId: "ses-1",
      fileName: "note.txt",
      mime: "text/plain",
      size: 12,
      kind: "text",
      status: "staged",
    });
  });

  test("reads_chat_attachment_when_host_returns_ready_file", async () => {
    // Given: a staged attachment id maps to a ready text artifact.
    const host = new FakeAttachmentHost([
      {
        id: "att-1",
        sessionId: "ses-1",
        fileName: "note.txt",
        mime: "text/plain",
        size: 12,
        kind: "text",
        status: "ready",
        dataUrl: "data:text/plain;base64,aGVsbG8=",
      },
    ]);

    // When: the frontend reads the staged attachment.
    const result = await readChatAttachment(
      { sessionId: "ses-1", attachmentId: "att-1" },
      host,
    );

    // Then: the typed ready artifact is returned through the expected command.
    expect(host.calls).toEqual([
      {
        command: "read_chat_attachment",
        payload: { request: { sessionId: "ses-1", attachmentId: "att-1" } },
      },
    ]);
    expect(result.status).toBe("ready");
    expect(result.dataUrl).toBe("data:text/plain;base64,aGVsbG8=");
  });

  test("converts_staged_ncm_when_host_returns_audio_artifact", async () => {
    // Given: a staged NCM attachment can be converted by persona id.
    const host = new FakeAttachmentHost([
      {
        id: "att-1",
        sessionId: "ses-1",
        fileName: "song.mp3",
        mime: "audio/mpeg",
        size: 32,
        kind: "audio",
        status: "ready",
        dataUrl: "data:audio/mpeg;base64,AAAA",
      },
    ]);

    // When: conversion is requested.
    const result = await convertStagedNcm(
      { sessionId: "ses-1", attachmentId: "att-1", personaId: "xiaozhu" },
      host,
    );

    // Then: the command uses camelCase request keys and returns audio only.
    expect(host.calls[0]).toEqual({
      command: "convert_staged_ncm",
      payload: {
        request: {
          sessionId: "ses-1",
          attachmentId: "att-1",
          personaId: "xiaozhu",
        },
      },
    });
    expect(result.kind).toBe("audio");
  });

  test("exports_chat_artifact_without_returning_native_paths", async () => {
    // Given: native export returns a secret-free receipt.
    const host = new FakeAttachmentHost([
      {
        artifactId: "att-1",
        sessionId: "ses-1",
        fileName: "song.mp3",
        mime: "audio/mpeg",
        size: 32,
        exportedAt: "2026-08-28T01:02:03.000Z",
      },
    ]);

    // When: the frontend exports an artifact.
    const result = await exportChatArtifact({ sessionId: "ses-1", artifactId: "att-1" }, host);

    // Then: no native destination path appears in the public result.
    expect(host.calls[0]).toEqual({
      command: "export_chat_artifact",
      payload: {
        request: {
          sessionId: "ses-1",
          artifactId: "att-1",
        },
      },
    });
    expect(Object.keys(result)).not.toContain("destinationPath");
    expect(result.fileName).toBe("song.mp3");
  });

  test("discards_and_cleans_up_session_with_exact_commands", async () => {
    // Given: native cleanup commands return empty success receipts.
    const host = new FakeAttachmentHost([{ discarded: true }, { removed: 2 }]);

    // When: an attachment is discarded and the session staging area is cleaned.
    const discard = await discardChatAttachment(
      { sessionId: "ses-1", attachmentId: "att-1" },
      host,
    );
    const cleanup = await cleanupChatSession({ sessionId: "ses-1" }, host);

    // Then: both commands use typed request wrappers.
    expect(host.calls).toEqual([
      {
        command: "discard_chat_attachment",
        payload: { request: { sessionId: "ses-1", attachmentId: "att-1" } },
      },
      {
        command: "cleanup_chat_session",
        payload: { request: { sessionId: "ses-1" } },
      },
    ]);
    expect(discard).toEqual({ discarded: true });
    expect(cleanup).toEqual({ removed: 2 });
  });

  test("rejects_malformed_requests_and_native_responses_before_state_use", async () => {
    // Given: malformed values cross the host boundary.
    const unsupportedMimeHost = new FakeAttachmentHost([
      {
        id: "att-1",
        sessionId: "ses-1",
        fileName: "note.exe",
        mime: "application/x-msdownload",
        size: 12,
        kind: "text",
        status: "ready",
        dataUrl: "data:application/x-msdownload;base64,AAAA",
      },
    ]);
    const leakedPathHost = new FakeAttachmentHost([
      {
        id: "att-1",
        sessionId: "ses-1",
        fileName: "note.txt",
        mime: "text/plain",
        size: 12,
        kind: "text",
        status: "ready",
        dataUrl: "data:text/plain;base64,aGVsbG8=",
        path: "C:\\Users\\secret\\note.txt",
      },
    ]);

    // When/Then: unsupported MIME, negative size, empty IDs, and leaked paths reject.
    await expect(
      readChatAttachment({ sessionId: "ses-1", attachmentId: "att-1" }, unsupportedMimeHost),
    ).rejects.toThrow("unsupported attachment MIME");
    await expect(
      stageChatAttachment(
        {
          sessionId: "ses-1",
          fileName: "note.txt",
          mime: "text/plain",
          size: -1,
          bytes: [1],
        },
        new FakeAttachmentHost([]),
      ),
    ).rejects.toThrow("invalid attachment size");
    await expect(
      readChatAttachment({ sessionId: "", attachmentId: "att-1" }, new FakeAttachmentHost([])),
    ).rejects.toThrow("invalid sessionId");
    await expect(
      readChatAttachment({ sessionId: "ses-1", attachmentId: "att-1" }, leakedPathHost),
    ).rejects.toThrow("native path field");
  });
});
