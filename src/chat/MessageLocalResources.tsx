import { useEffect, useState } from "react";
import type { Lang } from "../lib/i18n";
import { getChatMessageResources, type LocalResource } from "./localResources";
import { LocalResourceTray } from "./LocalResourceTray";

export function MessageLocalResources({ directory, sessionId, messageId, resources, lang }: {
  readonly directory: string;
  readonly sessionId: string;
  readonly messageId: string;
  readonly resources?: readonly LocalResource[];
  readonly lang: Lang;
}) {
  const [loaded, setLoaded] = useState<readonly LocalResource[]>([]);
  useEffect(() => {
    if (resources !== undefined || !directory || !sessionId) return;
    let disposed = false;
    setLoaded([]);
    void getChatMessageResources(directory, sessionId, messageId)
      .then(items => { if (!disposed) setLoaded(items); })
      .catch(() => { /* A missing original must not prevent reading the conversation. */ });
    return () => { disposed = true; };
  }, [directory, sessionId, messageId, resources]);
  return <LocalResourceTray resources={resources ?? loaded} lang={lang} />;
}
