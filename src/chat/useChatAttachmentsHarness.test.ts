import { act } from "@testing-library/react";
import type {
  AttachmentCommandName,
  AttachmentCommandPayload,
  AttachmentHost,
  AttachmentIdRequest,
  ExportChatArtifactReceipt,
  ExportChatArtifactRequest,
  ReadyChatAttachment,
  StageChatAttachmentRequest,
  StagedChatAttachment,
} from "./attachmentApi";

type Deferred<T> = {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: Error) => void;
};

export type FakeHost = AttachmentHost & {
  readonly stageRequests: StageChatAttachmentRequest[];
  readonly convertRequests: AttachmentIdRequest[];
  readonly exportRequests: ExportChatArtifactRequest[];
  readonly readRequests: AttachmentIdRequest[];
  readonly discardRequests: AttachmentIdRequest[];
  readonly cleanupSessions: string[];
  readonly stageQueue: Deferred<StagedChatAttachment>[];
  readonly convertQueue: Deferred<ReadyChatAttachment>[];
  readonly exportQueue: Deferred<ExportChatArtifactReceipt>[];
  readonly readResponses: Map<string, ReadyChatAttachment>;
};

export function createFakeHost(): FakeHost {
  const fake: FakeHost = {
    stageRequests: [],
    convertRequests: [],
    exportRequests: [],
    readRequests: [],
    discardRequests: [],
    cleanupSessions: [],
    stageQueue: [],
    convertQueue: [],
    exportQueue: [],
    readResponses: new Map<string, ReadyChatAttachment>(),
    invoke(command: AttachmentCommandName, payload: AttachmentCommandPayload): Promise<unknown> {
      switch (command) {
        case "stage_chat_attachment":
          return enqueue(fake.stageRequests, fake.stageQueue, requireStageRequest(payload.request));
        case "convert_staged_ncm":
          return enqueue(fake.convertRequests, fake.convertQueue, requireAttachmentRequest(payload.request));
        case "export_chat_artifact":
          return enqueue(fake.exportRequests, fake.exportQueue, requireExportRequest(payload.request));
        case "read_chat_attachment": {
          const request = requireAttachmentRequest(payload.request);
          fake.readRequests.push(request);
          return Promise.resolve(fake.readResponses.get(request.attachmentId) ?? ready(request.attachmentId, "notes.md", "text/plain", "text"));
        }
        case "discard_chat_attachment":
          fake.discardRequests.push(requireAttachmentRequest(payload.request));
          return Promise.resolve({ discarded: true });
        case "cleanup_chat_session":
          fake.cleanupSessions.push(requireCleanupSession(payload.request));
          return Promise.resolve({ removed: 1 });
        default: {
          const exhaustive: never = command;
          return Promise.resolve(exhaustive);
        }
      }
    },
  };
  return fake;
}

export async function drive(action: () => void): Promise<void> {
  await act(async () => {
    action();
    await Promise.resolve();
  });
}

export function file(name: string, content: string, type: string): File {
  return new File([content], name, { type });
}

export function sizedFile(name: string, size: number, type: string): File {
  return new File([new Uint8Array(size)], name, { type });
}

export async function resolveStage(
  host: FakeHost,
  index: number,
  id: string,
  kind: StagedChatAttachment["kind"],
): Promise<void> {
  const request = host.stageRequests[index];
  const pending = host.stageQueue[index];
  if (request === undefined || pending === undefined) throw new Error("missing staged request");
  await drive(() => pending.resolve({
    id,
    sessionId: request.sessionId,
    fileName: request.fileName,
    mime: request.mime,
    size: request.size,
    kind,
    status: "staged",
  }));
}

export async function rejectStage(host: FakeHost, index: number, reason: string): Promise<void> {
  const pending = host.stageQueue[index];
  if (pending === undefined) throw new Error("missing staged request");
  await drive(() => pending.reject(new Error(reason)));
}

export async function resolveConvert(
  host: FakeHost,
  index: number,
  attachment: ReadyChatAttachment,
): Promise<void> {
  const pending = host.convertQueue[index];
  if (pending === undefined) throw new Error("missing convert request");
  await drive(() => pending.resolve(attachment));
}

export async function rejectConvert(host: FakeHost, index: number, reason: string): Promise<void> {
  const pending = host.convertQueue[index];
  if (pending === undefined) throw new Error("missing convert request");
  await drive(() => pending.reject(new Error(reason)));
}

export async function rejectExport(host: FakeHost, index: number, reason: string): Promise<void> {
  const pending = host.exportQueue[index];
  if (pending === undefined) throw new Error("missing export request");
  await drive(() => pending.reject(new Error(reason)));
}

export async function resolveExport(host: FakeHost, index: number, fileName: string): Promise<void> {
  const request = host.exportRequests[index];
  const pending = host.exportQueue[index];
  if (request === undefined || pending === undefined) throw new Error("missing export request");
  await drive(() => pending.resolve({
    artifactId: request.artifactId,
    sessionId: request.sessionId,
    fileName,
    mime: "audio/mpeg",
    size: 3,
    exportedAt: "2026-08-28T00:00:00Z",
  }));
}

export function ready(
  id: string,
  fileName: string,
  mime: ReadyChatAttachment["mime"],
  kind: ReadyChatAttachment["kind"],
): ReadyChatAttachment {
  return { id, sessionId: "ses-1", fileName, mime, size: 3, kind, status: "ready", dataUrl: `data:${mime};base64,AAAA` };
}

function enqueue<TRequest, TResponse>(
  requests: TRequest[],
  queue: Deferred<TResponse>[],
  request: TRequest,
): Promise<TResponse> {
  const pending = deferred<TResponse>();
  requests.push(request);
  queue.push(pending);
  return pending.promise;
}

function deferred<T>(): Deferred<T> {
  let resolveValue: ((value: T) => void) | null = null;
  let rejectValue: ((error: Error) => void) | null = null;
  const promise = new Promise<T>((resolve, reject) => {
    resolveValue = resolve;
    rejectValue = reject;
  });
  return {
    promise,
    resolve(value) {
      if (resolveValue === null) throw new Error("deferred resolver missing");
      resolveValue(value);
    },
    reject(error) {
      if (rejectValue === null) throw new Error("deferred rejecter missing");
      rejectValue(error);
    },
  };
}

function requireStageRequest(request: AttachmentCommandPayload["request"]): StageChatAttachmentRequest {
  if ("fileName" in request && "bytes" in request) return request;
  throw new Error("stage request expected");
}

function requireAttachmentRequest(request: AttachmentCommandPayload["request"]): AttachmentIdRequest {
  if ("attachmentId" in request) return request;
  throw new Error("attachment request expected");
}

function requireExportRequest(request: AttachmentCommandPayload["request"]): ExportChatArtifactRequest {
  if ("artifactId" in request && !("attachmentId" in request)) return request;
  throw new Error("export request expected");
}

function requireCleanupSession(request: AttachmentCommandPayload["request"]): string {
  if ("sessionId" in request && !("attachmentId" in request) && !("fileName" in request) && !("artifactId" in request)) {
    return request.sessionId;
  }
  throw new Error("cleanup request expected");
}
