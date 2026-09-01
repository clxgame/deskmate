import { prepareModelReadyAttachment, toOpenCodeFilePart, type OpenCodeFilePart } from "./attachments";
import {
  itemLimitForSource,
  MAX_SESSION_ATTACHMENT_BYTES,
  nextBudget,
  type AttachmentBudget,
} from "./useChatAttachmentBudgets";
import type {
  ReadyChatAttachment,
  StageChatAttachmentRequest,
  StagedChatAttachment,
  SupportedAttachmentMime,
} from "./attachmentApi";
import { isSupportedAttachmentMime } from "./attachmentApi";
import type {
  AttachmentDraft,
  GeneratedArtifact,
  StagedSource,
  StagedSourceKind,
} from "./attachmentState";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const TEXT_EXTENSIONS = new Set([
  "c", "cfg", "conf", "cpp", "css", "csv", "go", "h", "hpp", "html", "ini",
  "java", "js", "json", "jsx", "log", "md", "mdx", "mjs", "mts", "py", "rs",
  "scss", "sh", "sql", "toml", "ts", "tsx", "txt", "vue", "xml", "yaml", "yml",
]);

export type AttachmentStagePlan =
  | { readonly kind: "upload"; readonly request: StageChatAttachmentRequest }
  | { readonly kind: "reject"; readonly message: string };
type MimeInference =
  | { readonly kind: "mime"; readonly value: SupportedAttachmentMime }
  | { readonly kind: "reject"; readonly message: string };

export type PreparedModelAttachments = {
  readonly fileParts: readonly OpenCodeFilePart[];
  readonly fallbackPrompt: string | null;
  readonly shouldSendToModel: boolean;
};

export function inferDraft(file: File, localId: string): AttachmentDraft {
  return {
    localId,
    name: file.name,
    mime: inferDisplayMime(file.name, file.type),
    size: file.size,
    sourceKind: sourceKindOf(file.name),
  };
}

export async function planStageUpload(
  file: File,
  sessionId: string,
  committed: AttachmentBudget,
): Promise<AttachmentStagePlan> {
  const mime = tryInferSupportedMime(file.name, file.type);
  if (mime.kind !== "mime") {
    return { kind: "reject", message: mime.message };
  }
  const mimeValue = mime.value;
  const sourceKind = sourceKindOf(file.name);
  const itemLimit = itemLimitForSource(sourceKind);
  if (file.size > itemLimit) {
    return { kind: "reject", message: `${file.name} 超过 ${mib(itemLimit)} MB 限制` };
  }
  const budget = nextBudget(committed, sourceKind, file.size);
  if (budget.ordinaryBytes > itemLimitForSource("ordinary")) {
    return { kind: "reject", message: "普通附件总大小超过 20 MB 限制" };
  }
  if (budget.totalBytes > MAX_SESSION_ATTACHMENT_BYTES) {
    return { kind: "reject", message: "附件总大小超过 64 MB 限制" };
  }
  if (mimeValue.startsWith("audio/") && sourceKind !== "ncm") {
    return { kind: "reject", message: `${file.name} 暂不支持作为模型附件读取` };
  }
  const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
  return {
    kind: "upload",
    request: { sessionId, fileName: file.name, mime: mimeValue, size: file.size, bytes },
  };
}

export function toStagedSource(
  attachment: StagedChatAttachment,
  sourceKind: StagedSourceKind,
): StagedSource {
  return {
    id: attachment.id,
    name: attachment.fileName,
    mime: attachment.mime,
    size: attachment.size,
    kind: sourceKind,
  };
}

export function toGeneratedArtifact(
  attachment: ReadyChatAttachment,
  sourceId: string,
): GeneratedArtifact {
  return {
    id: attachment.id,
    sourceId,
    name: attachment.fileName,
    mime: attachment.mime,
    size: attachment.size,
    previewDataUrl: attachment.dataUrl,
  };
}

export async function prepareOpenCodeFilePart(
  attachment: ReadyChatAttachment,
): Promise<OpenCodeFilePart> {
  const modelReady = await prepareModelReadyAttachment({
    metadata: {
      id: attachment.id,
      name: attachment.fileName,
      mime: attachment.mime,
      size: attachment.size,
    },
    bytes: bytesFromDataUrl(attachment.dataUrl),
  });
  return toOpenCodeFilePart(modelReady);
}

export function buildPreparedModelAttachments(
  message: string,
  fileParts: readonly OpenCodeFilePart[],
): PreparedModelAttachments {
  const trimmed = message.trim();
  const fallbackPrompt = fileParts.length === 0
    ? null
    : `请读取我上传的附件：${fileParts.map((item) => item.filename).join(", ")}`;
  return {
    fileParts,
    fallbackPrompt,
    shouldSendToModel: trimmed.length > 0 || fileParts.length > 0,
  };
}

export class AttachmentControllerError extends Error {
  readonly name = "AttachmentControllerError";
}

function tryInferSupportedMime(
  name: string,
  mime: string,
): MimeInference {
  const normalized = mime.toLowerCase();
  const extensionMime = mimeFromExtension(name);
  if (extensionMime === "application/x-ncm") return { kind: "mime", value: extensionMime };
  const candidate = normalized === "application/octet-stream" ? extensionMime : normalized || extensionMime;
  if (isSupportedAttachmentMime(candidate)) return { kind: "mime", value: candidate };
  if (TEXT_EXTENSIONS.has(extensionOf(name))) return { kind: "mime", value: "text/plain" };
  return { kind: "reject", message: `${name} 暂不支持读取，请选择图片、PDF、DOCX、文本或 NCM 文件` };
}

function inferDisplayMime(name: string, mime: string): string {
  const normalized = mime.toLowerCase();
  const extensionMime = mimeFromExtension(name);
  if (extensionMime === "application/x-ncm") return extensionMime;
  const candidate = normalized === "application/octet-stream" ? extensionMime : normalized || extensionMime;
  if (candidate) return candidate;
  if (TEXT_EXTENSIONS.has(extensionOf(name))) return "text/plain";
  return "application/octet-stream";
}

function mimeFromExtension(name: string): SupportedAttachmentMime | "" {
  switch (extensionOf(name)) {
    case "ncm":
      return "application/x-ncm";
    case "flac":
      return "audio/flac";
    case "mp3":
      return "audio/mpeg";
    case "m4a":
      return "audio/mp4";
    case "ogg":
      return "audio/ogg";
    case "wav":
      return "audio/wav";
    case "webm":
      return "audio/webm";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "pdf":
      return "application/pdf";
    case "docx":
      return DOCX_MIME;
    default:
      return "";
  }
}

function sourceKindOf(name: string): StagedSourceKind {
  return extensionOf(name) === "ncm" ? "ncm" : "ordinary";
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function mib(bytes: number): number {
  return bytes / (1024 * 1024);
}

function bytesFromDataUrl(dataUrl: string): ArrayBuffer {
  const marker = ";base64,";
  const markerIndex = dataUrl.indexOf(marker);
  if (!dataUrl.startsWith("data:") || markerIndex < 0) {
    throw new AttachmentControllerError("invalid staged attachment data URL");
  }
  const binary = atob(dataUrl.slice(markerIndex + marker.length));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}
