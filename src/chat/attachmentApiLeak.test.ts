import { describe, expect, test } from "bun:test";
import {
  cleanupChatSession,
  convertStagedNcm,
  discardChatAttachment,
  exportChatArtifact,
  readChatAttachment,
  stageChatAttachment,
  type AttachmentCommandName,
  type AttachmentCommandPayload,
  type AttachmentHost,
  type StageChatAttachmentRequest,
} from "./attachmentApi";

const MIB = 1024 * 1024;
const STAGE_REQUEST = {
  sessionId: "ses-1",
  fileName: "large.ncm",
  mime: "application/x-ncm",
  size: 64 * MIB,
  bytes: [1, 2, 3],
} satisfies StageChatAttachmentRequest;
const STAGED_RESPONSE = {
  id: "att-1",
  sessionId: "ses-1",
  fileName: "large.ncm",
  mime: "application/x-ncm",
  size: 64 * MIB,
  kind: "audio",
  status: "staged",
};
const READY_RESPONSE = {
  id: "att-1",
  sessionId: "ses-1",
  fileName: "song.mp3",
  mime: "audio/mpeg",
  size: 32,
  kind: "audio",
  status: "ready",
  dataUrl: "data:audio/mpeg;base64,AAAA",
};
const EXPORT_RESPONSE = {
  artifactId: "art-1",
  sessionId: "ses-1",
  fileName: "song.mp3",
  mime: "audio/mpeg",
  size: 32,
  exportedAt: "2026-09-01T10:00:00.000Z",
};

class SinglePassBytes extends Array<number> {
  private iteratorReads = 0;

  get iterations(): number {
    return this.iteratorReads;
  }

  override [Symbol.iterator](): ArrayIterator<number> {
    this.iteratorReads += 1;
    if (this.iteratorReads > 1) throw new Error("bytes walked twice");
    return super[Symbol.iterator]();
  }
}

class FakeAttachmentHost implements AttachmentHost {
  readonly calls: Array<{
    readonly command: AttachmentCommandName;
    readonly payload: AttachmentCommandPayload;
  }> = [];

  constructor(private readonly responses: readonly unknown[]) {}

  async invoke(command: AttachmentCommandName, payload: AttachmentCommandPayload): Promise<unknown> {
    this.calls.push({ command, payload });
    const response = this.responses[this.calls.length - 1];
    if (response instanceof Error) throw response;
    return response;
  }
}

describe("attachment api native path leak boundaries", () => {
  test("sends captured stage bytes when request bytes accessor swaps later", async () => {
    const firstBytes = [7, 8, 9];
    const swappedBytes: number[] = [];
    Object.defineProperty(swappedBytes, "0", {
      configurable: true,
      enumerable: true,
      value: "C:\\Users\\secret\\large.ncm",
    });
    let bytesReads = 0;
    const request: StageChatAttachmentRequest = {
      ...STAGE_REQUEST,
      get bytes(): readonly number[] {
        bytesReads += 1;
        return bytesReads === 1 ? firstBytes : swappedBytes;
      },
    };
    const host = new FakeAttachmentHost([STAGED_RESPONSE]);

    await expect(stageChatAttachment(request, host)).resolves.toMatchObject({ fileName: "large.ncm" });

    expect(bytesReads).toBe(1);
    expect(firstStageRequest(host).bytes).toBe(firstBytes);
    expect(host.calls).toEqual([
      { command: "stage_chat_attachment", payload: { request: { ...STAGE_REQUEST, bytes: firstBytes } } },
    ]);
  });

  test("drops nested request extra fields and accessors before host invocation", async () => {
    const request: StageChatAttachmentRequest & { readonly audit: unknown } = {
      ...STAGE_REQUEST,
      get audit(): unknown {
        throw new Error("extra accessor was read");
      },
    };
    const host = new FakeAttachmentHost([STAGED_RESPONSE]);

    await expect(stageChatAttachment(request, host)).resolves.toMatchObject({ id: "att-1" });

    expect(host.calls).toEqual([{ command: "stage_chat_attachment", payload: { request: STAGE_REQUEST } }]);
  });

  test("normalizes accessor-backed ids before invoking every command", async () => {
    const host = new FakeAttachmentHost([
      { ...READY_RESPONSE, fileName: "note.txt", mime: "text/plain", kind: "text", dataUrl: "data:text/plain;base64,aGk=" },
      { discarded: true },
      READY_RESPONSE,
      EXPORT_RESPONSE,
      { removed: 1 },
    ]);
    const readSession = swap("ses-1", "ses-read-2");
    const readAttachment = swap("att-1", "att-read-2");
    const discardSession = swap("ses-1", "ses-discard-2");
    const discardAttachment = swap("att-1", "att-discard-2");
    const convertSession = swap("ses-1", "ses-convert-2");
    const convertAttachment = swap("att-1", "att-convert-2");
    const convertPersona = swap("xiaozhu", "persona-2");
    const exportSession = swap("ses-1", "ses-export-2");
    const exportArtifact = swap("art-1", "art-2");
    const cleanupSession = swap("ses-1", "ses-cleanup-2");

    await readChatAttachment({ get sessionId() { return readSession(); }, get attachmentId() { return readAttachment(); } }, host);
    await discardChatAttachment({ get sessionId() { return discardSession(); }, get attachmentId() { return discardAttachment(); } }, host);
    await convertStagedNcm({ get sessionId() { return convertSession(); }, get attachmentId() { return convertAttachment(); }, get personaId() { return convertPersona(); } }, host);
    await exportChatArtifact({ get sessionId() { return exportSession(); }, get artifactId() { return exportArtifact(); } }, host);
    await cleanupChatSession({ get sessionId() { return cleanupSession(); } }, host);

    expect(host.calls).toEqual([
      { command: "read_chat_attachment", payload: { request: { sessionId: "ses-1", attachmentId: "att-1" } } },
      { command: "discard_chat_attachment", payload: { request: { sessionId: "ses-1", attachmentId: "att-1" } } },
      { command: "convert_staged_ncm", payload: { request: { sessionId: "ses-1", attachmentId: "att-1", personaId: "xiaozhu" } } },
      { command: "export_chat_artifact", payload: { request: { sessionId: "ses-1", artifactId: "art-1" } } },
      { command: "cleanup_chat_session", payload: { request: { sessionId: "ses-1" } } },
    ]);
  });

  test("rejects native path strings in response bytes fields", async () => {
    await expect(stageChatAttachment(STAGE_REQUEST, new FakeAttachmentHost([{ ...STAGED_RESPONSE, bytes: pathBytes("stage.ncm") }]))).rejects.toThrow("native path value leaked");
    await expect(readChatAttachment({ sessionId: "ses-1", attachmentId: "att-1" }, new FakeAttachmentHost([{ ...READY_RESPONSE, bytes: pathBytes("song.mp3") }]))).rejects.toThrow("native path value leaked");
    await expect(exportChatArtifact({ sessionId: "ses-1", artifactId: "art-1" }, new FakeAttachmentHost([{ ...EXPORT_RESPONSE, bytes: pathBytes("song.mp3") }]))).rejects.toThrow("native path value leaked");
  });

  test("iterates validated stage byte arrays exactly once", async () => {
    const bytes = new SinglePassBytes(7, 8, 9);
    const host = new FakeAttachmentHost([STAGED_RESPONSE]);

    await expect(stageChatAttachment({ ...STAGE_REQUEST, bytes }, host)).resolves.toMatchObject({ fileName: "large.ncm" });

    expect(bytes.iterations).toBe(1);
    expect(firstStageRequest(host).bytes).toBe(bytes);
  });
});

function firstStageRequest(host: FakeAttachmentHost): StageChatAttachmentRequest {
  const request = host.calls[0]?.payload.request;
  if (request === undefined || !("bytes" in request)) throw new Error("stage request not captured");
  return request;
}

function pathBytes(fileName: string): readonly string[] {
  return [`C:\\Users\\secret\\${fileName}`];
}

function swap(first: string, next: string): () => string {
  let calls = 0;
  return () => {
    calls += 1;
    return calls === 1 ? first : next;
  };
}
