import { invoke } from "@tauri-apps/api/core";
import type { OpenCodeFilePart } from "./attachments";

export type LocalResourceKind = "file" | "directory" | "audio" | "video";
export type LocalResource = {
  readonly id: string;
  readonly name: string;
  readonly kind: LocalResourceKind;
  readonly mime: string;
  readonly size: number | null;
  readonly previewUrl: string | null;
};
export type LocalResourceDirectory = {
  readonly relativePath: string;
  readonly entries: readonly { readonly name: string; readonly kind: LocalResourceKind; readonly size: number | null }[];
  readonly truncated: boolean;
};
export type PreparedLocalResources = { readonly parts: readonly OpenCodeFilePart[]; readonly text: string };

const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "wave", "m4a", "aac", "flac", "ogg", "oga", "opus", "aiff", "aif", "wma"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "webm", "m4v", "mkv", "avi", "ogv", "mpeg", "mpg"]);
const LEGACY_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "pdf", "docx", "ncm", "c", "cfg", "conf", "cpp", "css", "csv", "go", "h", "hpp", "html", "ini",
  "java", "js", "json", "jsx", "log", "md", "mdx", "mjs", "mts", "py", "rs", "scss", "sh", "sql", "toml", "ts", "tsx", "txt", "vue", "xml", "yaml", "yml",
]);
const extension = (name: string) => name.split(".").at(-1)?.toLowerCase() ?? "";

export function isMediaFile(file: Pick<File, "name" | "type">): boolean {
  return /^(audio|video)\//.test(file.type) || AUDIO_EXTENSIONS.has(extension(file.name)) || VIDEO_EXTENSIONS.has(extension(file.name));
}

export function usesLegacyAttachment(resource: LocalResource): boolean {
  return resource.kind === "file" && (LEGACY_EXTENSIONS.has(extension(resource.name)) || resource.mime.startsWith("text/"));
}

export function parseLocalResources(value: unknown): LocalResource[] {
  if (!Array.isArray(value)) throw new Error("Invalid local resources");
  return value.map(item => {
    if (!item || typeof item !== "object" || typeof item.id !== "string" || !/^[a-zA-Z0-9_-]+$/.test(item.id)
      || typeof item.name !== "string" || !item.name || /[\\/]/.test(item.name)
      || !["file", "directory", "audio", "video"].includes(item.kind)
      || typeof item.mime !== "string" || (item.size !== null && (!Number.isSafeInteger(item.size) || item.size < 0))) {
      throw new Error("Invalid local resource metadata");
    }
    // Only the registered native protocol can serve previews; never trust an arbitrary URL.
    const previewUrl = typeof item.previewUrl === "string" && (
      item.previewUrl === `chat-resource://localhost/${item.id}` ||
      item.previewUrl === `http://chat-resource.localhost/${item.id}` ||
      item.previewUrl === `https://chat-resource.localhost/${item.id}`
    ) ? item.previewUrl : null;
    return { id: item.id, name: item.name, kind: item.kind, mime: item.mime, size: item.size, previewUrl };
  });
}

export async function pickChatResources(title: string, directory = false): Promise<LocalResource[]> {
  return parseLocalResources(await invoke("pick_chat_resources", { title, directory }));
}

export function listChatResourceDirectory(resourceId: string): Promise<LocalResourceDirectory> {
  return invoke("list_chat_resource_directory", { resourceId });
}

export async function readLegacyResource(resourceId: string): Promise<File> {
  const file = await invoke<{ fileName: string; base64: string }>("read_chat_resource_attachment", { resourceId });
  return new File([Uint8Array.from(atob(file.base64), char => char.charCodeAt(0))], file.fileName);
}

export async function stageMediaResource(file: File): Promise<LocalResource> {
  // Native drops pass references. Bytes are only needed for clipboard/browser File objects.
  if (file.size > 64 * 1024 * 1024) throw new Error("resource_upload_size_limit");
  const value = await invoke("stage_chat_resource_upload", {
    fileName: file.name, mime: file.type, bytes: Array.from(new Uint8Array(await file.arrayBuffer())),
  });
  return parseLocalResources([value])[0];
}

export function prepareChatResources(directory: string, sessionId: string, messageId: string, resourceIds: readonly string[]): Promise<PreparedLocalResources> {
  return invoke("prepare_chat_resources", { directory, sessionId, messageId, resourceIds });
}

export async function getChatMessageResources(directory: string, sessionId: string, messageId: string): Promise<LocalResource[]> {
  return parseLocalResources(await invoke("get_chat_message_resources", { directory, sessionId, messageId }));
}

export function discardChatResources(resourceIds: readonly string[]): Promise<void> {
  return resourceIds.length ? invoke("discard_chat_resources", { resourceIds }) : Promise.resolve();
}

export function stripLocalResourceContext(text: string): string {
  return text.replace(/\n*<yume-local-resources>\n[\s\S]*?\n<\/yume-local-resources>/g, "").trim();
}
