import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import {
  AttachmentApiError,
  assertNoNativePathLeak,
  normalizeAttachmentIdRequest,
  normalizeCleanupRequest,
  normalizeConvertRequest,
  normalizeExportRequest,
  normalizeStageRequest,
  parseBoolean,
  parseDataUrl,
  parseFileName,
  parseId,
  parseKind,
  parseMime,
  parseRecord,
  parseSize,
  parseStatus,
} from "./attachmentApiBoundary";
import type {
  AttachmentIdRequest,
  ChatAttachmentKind,
  CleanupChatSessionRequest,
  ConvertStagedNcmRequest,
  ExportChatArtifactRequest,
  ReadyAttachmentStatus,
  StageChatAttachmentRequest,
  StagedAttachmentStatus,
  SupportedAttachmentMime,
} from "./attachmentApiBoundary";

export { AttachmentApiError, isSupportedAttachmentMime } from "./attachmentApiBoundary";
export type {
  AttachmentIdRequest,
  ChatAttachmentKind,
  CleanupChatSessionRequest,
  ConvertStagedNcmRequest,
  ExportChatArtifactRequest,
  ReadyAttachmentStatus,
  StageChatAttachmentRequest,
  StagedAttachmentStatus,
  SupportedAttachmentMime,
} from "./attachmentApiBoundary";

export type AttachmentCommandName =
  | "stage_chat_attachment"
  | "read_chat_attachment"
  | "discard_chat_attachment"
  | "convert_staged_ncm"
  | "export_chat_artifact"
  | "cleanup_chat_session";

export type StagedChatAttachment = { readonly id: string; readonly sessionId: string; readonly fileName: string; readonly mime: SupportedAttachmentMime; readonly size: number; readonly kind: ChatAttachmentKind; readonly status: StagedAttachmentStatus };
export type ReadyChatAttachment = { readonly id: string; readonly sessionId: string; readonly fileName: string; readonly mime: SupportedAttachmentMime; readonly size: number; readonly kind: ChatAttachmentKind; readonly status: ReadyAttachmentStatus; readonly dataUrl: string; readonly truncated?: boolean };
export type ExportChatArtifactReceipt = { readonly artifactId: string; readonly sessionId: string; readonly fileName: string; readonly mime: SupportedAttachmentMime; readonly size: number; readonly exportedAt: string };
export type DiscardChatAttachmentReceipt = { readonly discarded: true };
export type CleanupChatSessionReceipt = { readonly removed: number };
export type AttachmentCommandPayload =
  | { readonly request: StageChatAttachmentRequest }
  | { readonly request: AttachmentIdRequest }
  | { readonly request: ConvertStagedNcmRequest }
  | { readonly request: ExportChatArtifactRequest }
  | { readonly request: CleanupChatSessionRequest };

export interface AttachmentHost {
  invoke(command: AttachmentCommandName, payload: AttachmentCommandPayload): Promise<unknown>;
}

type InvokeRequest<T> = {
  readonly host: AttachmentHost;
  readonly command: AttachmentCommandName;
  readonly request: AttachmentCommandPayload["request"];
  readonly parse: (response: unknown) => T;
  readonly trustedOpaqueBytes?: readonly number[];
};
type AttachmentBase = { readonly id: string; readonly sessionId: string; readonly fileName: string; readonly mime: SupportedAttachmentMime; readonly size: number; readonly kind: ChatAttachmentKind };

export const tauriAttachmentHost: AttachmentHost = {
  invoke(command, payload) {
    return tauriInvoke(command, payload);
  },
};

export async function stageChatAttachment(request: StageChatAttachmentRequest, host: AttachmentHost = tauriAttachmentHost): Promise<StagedChatAttachment> {
  const normalized = normalizeStageRequest(request);
  return invokeAndParse({ host, command: "stage_chat_attachment", request: normalized, parse: parseStagedAttachment, trustedOpaqueBytes: normalized.bytes });
}

export async function readChatAttachment(request: AttachmentIdRequest, host: AttachmentHost = tauriAttachmentHost): Promise<ReadyChatAttachment> {
  return invokeAndParse({ host, command: "read_chat_attachment", request: normalizeAttachmentIdRequest(request), parse: parseReadyAttachment });
}

export async function discardChatAttachment(request: AttachmentIdRequest, host: AttachmentHost = tauriAttachmentHost): Promise<DiscardChatAttachmentReceipt> {
  return invokeAndParse({ host, command: "discard_chat_attachment", request: normalizeAttachmentIdRequest(request), parse: parseDiscardReceipt });
}

export async function convertStagedNcm(request: ConvertStagedNcmRequest, host: AttachmentHost = tauriAttachmentHost): Promise<ReadyChatAttachment> {
  const attachment = await invokeAndParse({ host, command: "convert_staged_ncm", request: normalizeConvertRequest(request), parse: parseReadyAttachment });
  if (attachment.kind !== "audio") throw new AttachmentApiError("invalid converted attachment kind");
  return attachment;
}

export async function exportChatArtifact(request: ExportChatArtifactRequest, host: AttachmentHost = tauriAttachmentHost): Promise<ExportChatArtifactReceipt> {
  return invokeAndParse({ host, command: "export_chat_artifact", request: normalizeExportRequest(request), parse: parseExportReceipt });
}

export async function cleanupChatSession(request: CleanupChatSessionRequest, host: AttachmentHost = tauriAttachmentHost): Promise<CleanupChatSessionReceipt> {
  return invokeAndParse({ host, command: "cleanup_chat_session", request: normalizeCleanupRequest(request), parse: parseCleanupReceipt });
}

async function invokeAndParse<T>(input: InvokeRequest<T>): Promise<T> {
  assertNoNativePathLeak(input.request, "request", input.trustedOpaqueBytes);
  const response = await input.host.invoke(input.command, { request: input.request });
  assertNoNativePathLeak(response, "response");
  return input.parse(response);
}

function parseStagedAttachment(value: unknown): StagedChatAttachment {
  const record = parseRecord(value, "staged attachment");
  return { ...parseAttachmentBase(record, "staged attachment"), status: parseStatus(record["status"], "staged") };
}

function parseReadyAttachment(value: unknown): ReadyChatAttachment {
  const record = parseRecord(value, "ready attachment");
  const truncated = record["truncated"];
  return {
    ...parseAttachmentBase(record, "ready attachment"),
    status: parseStatus(record["status"], "ready"),
    dataUrl: parseDataUrl(record["dataUrl"]),
    ...(truncated === undefined ? {} : { truncated: parseBoolean(truncated, "truncated") }),
  };
}

function parseExportReceipt(value: unknown): ExportChatArtifactReceipt {
  const record = parseRecord(value, "export receipt");
  return {
    artifactId: parseId(record["artifactId"], "artifactId"),
    sessionId: parseId(record["sessionId"], "sessionId"),
    fileName: parseFileName(record["fileName"]),
    mime: parseMime(record["mime"]),
    size: parseSize(record["size"]),
    exportedAt: parseId(record["exportedAt"], "exportedAt"),
  };
}

function parseDiscardReceipt(value: unknown): DiscardChatAttachmentReceipt {
  const record = parseRecord(value, "discard receipt");
  if (record["discarded"] !== true) throw new AttachmentApiError("invalid discard receipt");
  return { discarded: true };
}

function parseCleanupReceipt(value: unknown): CleanupChatSessionReceipt {
  return { removed: parseSize(parseRecord(value, "cleanup receipt")["removed"]) };
}

function parseAttachmentBase(value: unknown, context: string): AttachmentBase {
  const record = parseRecord(value, context);
  return {
    id: parseId(record["id"], "id"),
    sessionId: parseId(record["sessionId"], "sessionId"),
    fileName: parseFileName(record["fileName"]),
    mime: parseMime(record["mime"]),
    size: parseSize(record["size"]),
    kind: parseKind(record["kind"]),
  };
}
