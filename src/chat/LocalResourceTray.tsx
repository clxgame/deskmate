import { useEffect, useId, useState } from "react";
import { File, Folder, Image, MusicNote, VideoCamera, X } from "@phosphor-icons/react";
import type { Lang } from "../lib/i18n";
import { formatAttachmentSize } from "./attachments";
import { listChatResourceDirectory, type LocalResource, type LocalResourceDirectory } from "./localResources";
import { localResourceCopy } from "./localResourceCopy";
import { MediaPreview } from "./MediaPreview";
import "./localResources.css";

export type LocalResourceTrayProps = {
  readonly resources: readonly LocalResource[];
  readonly onRemove?: (id: string) => void;
  readonly lang: Lang;
  readonly disabled?: boolean;
};

const resourceIcons = { file: File, directory: Folder, audio: MusicNote, video: VideoCamera, image: Image };
const DIRECTORY_PREVIEW_LIMIT = 100;

export function LocalResourceTray({ resources, onRemove, lang, disabled = false }: LocalResourceTrayProps) {
  if (resources.length === 0) return null;
  return (
    <section className="local-resource-tray" aria-label={localResourceCopy(lang).tray}>
      {resources.map((resource) => (
        <LocalResourceCard key={resource.id} resource={resource} onRemove={onRemove} lang={lang} disabled={disabled} />
      ))}
    </section>
  );
}

function LocalResourceCard({ resource, onRemove, lang, disabled }: {
  readonly resource: LocalResource;
  readonly onRemove?: (id: string) => void;
  readonly lang: Lang;
  readonly disabled: boolean;
}) {
  const copy = localResourceCopy(lang);
  const isImage = resource.mime.startsWith("image/");
  const Icon = isImage ? Image : resourceIcons[resource.kind];
  const isMedia = resource.kind === "audio" || resource.kind === "video";
  return (
    <article className={`local-resource-card local-resource-card-${resource.kind}`} aria-label={resource.name}>
      <div className="local-resource-header">
        <Icon size={18} aria-hidden="true" className="local-resource-icon" />
        <div className="local-resource-info">
          <span className="local-resource-name" title={resource.name}>{resource.name}</span>
          <span className="local-resource-meta">
            {isImage ? copy.image : copy[resource.kind]}
            {resource.kind !== "directory" && resource.size !== null ? ` · ${formatAttachmentSize(resource.size)}` : ""}
          </span>
        </div>
        {onRemove ? (
          <button type="button" className="local-resource-remove" disabled={disabled}
            aria-label={`${copy.remove} ${resource.name}`} title={copy.remove} onClick={() => onRemove(resource.id)}>
            <X size={16} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {isMedia && resource.previewUrl ? (
        <MediaPreview src={resource.previewUrl} name={resource.name} mime={resource.mime}
          kind={resource.kind as "audio" | "video"} lang={lang} />
      ) : null}
      {isImage && resource.previewUrl
        ? <ImagePreview src={resource.previewUrl} name={resource.name} lang={lang} /> : null}
      {(isMedia || isImage) && !resource.previewUrl
        ? <p className="local-resource-preview-note">{copy.unavailable}</p> : null}
      {resource.kind === "directory" ? <DirectoryPreview key={resource.id} resourceId={resource.id} name={resource.name} lang={lang} /> : null}
    </article>
  );
}

function ImagePreview({ src, name, lang }: { readonly src: string; readonly name: string; readonly lang: Lang }) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  return failedSource === src
    ? <p className="local-resource-preview-note" role="status">{localResourceCopy(lang).imageError}</p>
    : <img className="local-resource-image" src={src} alt={name} loading="lazy" decoding="async"
      onError={() => setFailedSource(src)} />;
}

function DirectoryPreview({ resourceId, name, lang }: {
  readonly resourceId: string;
  readonly name: string;
  readonly lang: Lang;
}) {
  const copy = localResourceCopy(lang);
  const contentId = useId();
  const [expanded, setExpanded] = useState(false);
  const [directory, setDirectory] = useState<LocalResourceDirectory | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!expanded || directory) return;
    let active = true;
    setFailed(false);
    void listChatResourceDirectory(resourceId).then((result) => {
      if (active) setDirectory(result);
    }).catch(() => {
      if (active) setFailed(true);
    });
    return () => { active = false; };
  }, [expanded, resourceId, directory, attempt]);

  const entries = directory?.entries.slice(0, DIRECTORY_PREVIEW_LIMIT);
  return (
    <div className="local-resource-directory">
      <button type="button" className="local-resource-directory-toggle" aria-expanded={expanded}
        aria-controls={contentId} aria-label={`${expanded ? copy.collapse : copy.expand} ${name}`}
        onClick={() => setExpanded((value) => !value)}>
        <span aria-hidden="true">{expanded ? "▾" : "▸"}</span> {expanded ? copy.collapse : copy.expand}
      </button>
      {expanded ? (
        <div id={contentId} className="local-resource-directory-content">
          {failed ? (
            <div className="local-resource-preview-note" role="status">
              <span>{copy.directoryError}</span>
              <button type="button" className="local-resource-retry" onClick={() => setAttempt((value) => value + 1)}>{copy.retry}</button>
            </div>
          ) : !entries ? <p className="local-resource-preview-note" role="status">{copy.loading}</p>
            : entries.length === 0 ? <p className="local-resource-preview-note">{copy.empty}</p>
              : <ul className="local-resource-entries" aria-label={`${name} · ${copy.directory}`}>
                {entries.map((entry) => (
                  <li key={entry.name}>
                    {entry.kind === "directory" ? <Folder size={14} aria-hidden="true" /> : <File size={14} aria-hidden="true" />}
                    <span className="local-resource-entry-name" title={entry.name}>{entry.name}</span>
                    <span className="local-resource-entry-size">{entry.kind === "directory" ? copy.directory
                      : entry.size !== null ? formatAttachmentSize(entry.size) : ""}</span>
                  </li>
                ))}
              </ul>}
          {directory && (directory.truncated || directory.entries.length > DIRECTORY_PREVIEW_LIMIT)
            ? <p className="local-resource-preview-note">{copy.truncated}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
