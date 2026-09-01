import * as mammoth from "mammoth";

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_TEXT_CHARS = 160_000;
const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const TEXT_EXTENSIONS = new Set([
  "c", "cfg", "conf", "cpp", "css", "csv", "go", "h", "hpp", "html", "ini",
  "java", "js", "json", "jsx", "log", "md", "mdx", "mjs", "mts", "py", "rs",
  "scss", "sh", "sql", "toml", "ts", "tsx", "txt", "vue", "xml", "yaml", "yml",
]);
const AUDIO_EXTENSIONS = new Set(["flac", "mp3", "ncm"]);

const SUPPORTED_IMAGE_MIME_TYPES = [
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
type SupportedImageMime = (typeof SUPPORTED_IMAGE_MIME_TYPES)[number];
const IMAGE_MIME_TYPES: ReadonlySet<string> = new Set(SUPPORTED_IMAGE_MIME_TYPES);

export interface OpenCodeFilePart {
  readonly type: "file";
  readonly mime: string;
  readonly filename: string;
  readonly url: string;
}

export type StagedAttachmentMetadata = { readonly id: string; readonly name: string; readonly mime: string; readonly size: number };

export type StagedAttachmentSource = { readonly metadata: StagedAttachmentMetadata; readonly bytes: ArrayBuffer };

export type TextModelReadyAttachment = {
  readonly id: string; readonly name: string; readonly mime: "text/plain"; readonly size: number;
  readonly kind: "text"; readonly status: "ready"; readonly dataUrl: string; readonly truncated: boolean;
};

export type ImageModelReadyAttachment = {
  readonly id: string; readonly name: string; readonly mime: SupportedImageMime;
  readonly size: number; readonly kind: "image"; readonly status: "ready"; readonly dataUrl: string;
};

export type ModelReadyAttachment = TextModelReadyAttachment | ImageModelReadyAttachment;

export async function prepareModelReadyAttachment(
  source: StagedAttachmentSource,
): Promise<ModelReadyAttachment> {
  const { metadata, bytes } = source;
  if (metadata.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`${metadata.name} 超过 20 MB 限制`);
  }

  const extension = extensionOf(metadata.name);
  const mime = normalizedMime(metadata.name, metadata.mime);
  if (AUDIO_EXTENSIONS.has(extension) || mime.startsWith("audio/")) {
    throw new Error(`${metadata.name} 暂不支持读取，请选择图片、PDF、DOCX 或文本文件`);
  }
  if (isSupportedImageMime(mime)) {
    return {
      id: metadata.id,
      name: metadata.name,
      mime,
      size: metadata.size,
      kind: "image",
      status: "ready",
      dataUrl: await readDataUrl(new Blob([bytes], { type: mime })),
    };
  }

  let text: string;
  if (mime === "application/pdf" || extension === "pdf") {
    text = await extractPdfText(bytes);
  } else if (mime === DOCX_MIME || extension === "docx") {
    const input = { arrayBuffer: bytes, buffer: new Uint8Array(bytes) };
    text = (await mammoth.extractRawText(input)).value;
  } else if (TEXT_EXTENSIONS.has(extension) || mime.startsWith("text/")) {
    text = new TextDecoder().decode(bytes);
  } else {
    throw new Error(`${metadata.name} 暂不支持读取，请选择图片、PDF、DOCX 或文本文件`);
  }

  const truncated = text.length > MAX_TEXT_CHARS;
  const bounded = truncated ? text.slice(0, MAX_TEXT_CHARS) : text;
  const suffix = truncated
    ? `\n\n[文件内容已截断，原文超过 ${MAX_TEXT_CHARS.toLocaleString()} 个字符]`
    : "";
  const normalizedText = `${bounded}${suffix}`.trim();
  return {
    id: metadata.id,
    name: metadata.name,
    mime: "text/plain",
    size: metadata.size,
    kind: "text",
    status: "ready",
    dataUrl: await readDataUrl(
      new Blob([normalizedText], { type: "text/plain;charset=utf-8" }),
    ),
    truncated,
  };
}

export function toOpenCodeFilePart(
  attachment: ModelReadyAttachment,
): OpenCodeFilePart {
  if (!isModelReadyAttachment(attachment)) throw new Error("Unsupported model attachment");
  return {
    type: "file",
    mime: attachment.mime,
    filename: attachment.name,
    url: attachment.dataUrl,
  };
}

export function formatAttachmentSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(size >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function normalizedMime(name: string, mime: string): string {
  const normalized = mime.toLowerCase();
  if (normalized && normalized !== "application/octet-stream") return normalized;
  switch (extensionOf(name)) {
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
      return "application/octet-stream";
  }
}

function isSupportedImageMime(mime: string): mime is SupportedImageMime {
  return IMAGE_MIME_TYPES.has(mime);
}

function isModelReadyAttachment(value: unknown): value is ModelReadyAttachment {
  if (typeof value !== "object" || value === null) return false;
  if (!("status" in value) || !("dataUrl" in value) || !("kind" in value) || !("mime" in value)) {
    return false;
  }
  if (value.status !== "ready" || typeof value.dataUrl !== "string" || typeof value.mime !== "string") return false;
  if (value.kind === "text") {
    return value.mime === "text/plain" && value.dataUrl.startsWith("data:text/plain");
  }
  if (value.kind === "image") {
    return isSupportedImageMime(value.mime) && value.dataUrl.startsWith(`data:${value.mime}`);
  }
  return false;
}

async function readDataUrl(value: Blob): Promise<string> {
  const bytes = new Uint8Array(await value.arrayBuffer());
  const chunks: string[] = [];
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.slice(offset, offset + chunkSize)));
  }
  return `data:${value.type};base64,${btoa(chunks.join(""))}`;
}

async function extractPdfText(data: ArrayBuffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const document = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  const pages: string[] = [];
  let extractedChars = 0;
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .filter(Boolean)
      .join(" ");
    pages.push(pageText);
    extractedChars += pageText.length;
    if (extractedChars >= MAX_TEXT_CHARS) break;
  }
  return pages.join("\n\n");
}
