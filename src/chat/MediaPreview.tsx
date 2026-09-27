import { useId, useState } from "react";
import type { Lang } from "../lib/i18n";
import { localResourceCopy } from "./localResourceCopy";
import "./localResources.css";

export type MediaPreviewProps = {
  readonly src: string;
  readonly name: string;
  readonly mime: string;
  readonly kind?: "audio" | "video";
  readonly lang?: Lang;
};

export function MediaPreview({ src, name, mime, kind, lang = "zh-CN" }: MediaPreviewProps) {
  const copy = localResourceCopy(lang);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const errorId = useId();
  const failed = failedSource === src;
  const isVideo = kind === "video" || (!kind && mime.startsWith("video/"));
  const mediaProps = {
    src,
    controls: true,
    preload: "metadata",
    "aria-label": `${copy.preview} ${name}`,
    "aria-describedby": failed ? errorId : undefined,
    onError: () => setFailedSource(src),
    onLoadedMetadata: () => setFailedSource(null),
  } as const;

  return (
    <div className={`local-resource-media local-resource-media-${isVideo ? "video" : "audio"}`}>
      {isVideo
        ? <video key={src} {...mediaProps} playsInline />
        : <audio key={src} {...mediaProps} />}
      {failed ? <p id={errorId} className="local-resource-preview-note" role="status">{copy.mediaError}</p> : null}
    </div>
  );
}
