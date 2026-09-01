export type ChatAttachmentKind = "image" | "text" | "audio";
export type StagedAttachmentStatus = "staged";
export type ReadyAttachmentStatus = "ready";
export type SupportedAttachmentMime =
  | "image/gif"
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "application/pdf"
  | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  | "text/plain"
  | "application/x-ncm"
  | "audio/flac"
  | "audio/mpeg"
  | "audio/mp4"
  | "audio/ogg"
  | "audio/wav"
  | "audio/webm";

export type StageChatAttachmentRequest = { readonly sessionId: string; readonly fileName: string; readonly mime: SupportedAttachmentMime; readonly size: number; readonly bytes: readonly number[] };
export type AttachmentIdRequest = { readonly sessionId: string; readonly attachmentId: string };
export type ConvertStagedNcmRequest = AttachmentIdRequest & { readonly personaId: string };
export type ExportChatArtifactRequest = { readonly sessionId: string; readonly artifactId: string };
export type CleanupChatSessionRequest = { readonly sessionId: string };

export class AttachmentApiError extends Error {
  readonly name = "AttachmentApiError";
  constructor(readonly reason: string) {
    super(reason);
  }
}

export function isSupportedAttachmentMime(value: string): value is SupportedAttachmentMime {
  return (
    value === "image/gif" ||
    value === "image/jpeg" ||
    value === "image/png" ||
    value === "image/webp" ||
    value === "application/pdf" ||
    value === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    value === "text/plain" ||
    value === "application/x-ncm" ||
    value === "audio/flac" ||
    value === "audio/mpeg" ||
    value === "audio/mp4" ||
    value === "audio/ogg" ||
    value === "audio/wav" ||
    value === "audio/webm"
  );
}

export function normalizeStageRequest(value: StageChatAttachmentRequest): StageChatAttachmentRequest {
  const source = parseObject(value, "stage request");
  const sessionId = parseId(readField(source, "sessionId"), "sessionId");
  const fileName = parseFileName(readField(source, "fileName"));
  const mime = parseMime(readField(source, "mime"));
  const size = parseSize(readField(source, "size"));
  const bytes = parseBytes(readField(source, "bytes"));
  return { sessionId, fileName, mime, size, bytes };
}

export function normalizeAttachmentIdRequest(value: AttachmentIdRequest): AttachmentIdRequest {
  const source = parseObject(value, "attachment id request");
  const sessionId = parseId(readField(source, "sessionId"), "sessionId");
  const attachmentId = parseId(readField(source, "attachmentId"), "attachmentId");
  return { sessionId, attachmentId };
}

export function normalizeConvertRequest(value: ConvertStagedNcmRequest): ConvertStagedNcmRequest {
  const source = parseObject(value, "convert request");
  const sessionId = parseId(readField(source, "sessionId"), "sessionId");
  const attachmentId = parseId(readField(source, "attachmentId"), "attachmentId");
  const personaId = parseId(readField(source, "personaId"), "personaId");
  return { sessionId, attachmentId, personaId };
}

export function normalizeExportRequest(value: ExportChatArtifactRequest): ExportChatArtifactRequest {
  const source = parseObject(value, "export request");
  const sessionId = parseId(readField(source, "sessionId"), "sessionId");
  const artifactId = parseId(readField(source, "artifactId"), "artifactId");
  return { sessionId, artifactId };
}

export function normalizeCleanupRequest(value: CleanupChatSessionRequest): CleanupChatSessionRequest {
  const source = parseObject(value, "cleanup request");
  const sessionId = parseId(readField(source, "sessionId"), "sessionId");
  return { sessionId };
}

export function parseRecord(value: unknown, context: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new AttachmentApiError(`invalid ${context}`);
  return Object.fromEntries(Object.entries(value));
}

export function parseId(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new AttachmentApiError(`invalid ${field}`);
  assertNoNativePathString(value, field);
  return value;
}

export function parseFileName(value: unknown): string {
  const fileName = parseId(value, "fileName");
  if (fileName.includes("/") || fileName.includes("\\") || /^[A-Za-z]:/.test(fileName)) throw new AttachmentApiError("invalid fileName");
  return fileName;
}

export function parseMime(value: unknown): SupportedAttachmentMime {
  if (typeof value !== "string" || !isSupportedAttachmentMime(value)) throw new AttachmentApiError("unsupported attachment MIME");
  return value;
}

export function parseSize(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new AttachmentApiError("invalid attachment size");
  return value;
}

export function parseBytes(value: unknown): readonly number[] {
  if (!Array.isArray(value)) throw new AttachmentApiError("invalid attachment bytes");
  for (const byte of value) {
    if (typeof byte !== "number" || !Number.isInteger(byte) || byte < 0 || byte > 255) throw new AttachmentApiError("invalid attachment bytes");
  }
  return value;
}

export function parseKind(value: unknown): ChatAttachmentKind {
  if (value === "image" || value === "text" || value === "audio") return value;
  throw new AttachmentApiError("invalid attachment kind");
}

export function parseStatus<T extends StagedAttachmentStatus | ReadyAttachmentStatus>(value: unknown, expected: T): T {
  if (value !== expected) throw new AttachmentApiError("invalid attachment status");
  return expected;
}

export function parseDataUrl(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("data:")) throw new AttachmentApiError("invalid attachment dataUrl");
  return value;
}

export function parseBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new AttachmentApiError(`invalid ${field}`);
  return value;
}

export function assertNoNativePathLeak(value: unknown, context: string, trustedOpaqueBytes?: readonly number[]): void {
  if (Array.isArray(value)) {
    if (trustedOpaqueBytes !== undefined && value === trustedOpaqueBytes) return;
    for (const item of value) assertNoNativePathLeak(item, context, trustedOpaqueBytes);
  } else if (typeof value === "string") {
    assertNoNativePathString(value, context);
  } else if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      if (key === "path" || key === "sourcePath" || key === "destinationPath") throw new AttachmentApiError("native path field leaked");
      assertNoNativePathLeak(child, key, trustedOpaqueBytes);
    }
  }
}

function parseObject(value: unknown, context: string): object {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new AttachmentApiError(`invalid ${context}`);
  return value;
}

function readField(source: object, field: string): unknown {
  return Reflect.get(source, field);
}

function assertNoNativePathString(value: string, field: string): void {
  if (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\") || value.startsWith("/")) throw new AttachmentApiError(`native path value leaked in ${field}`);
}
