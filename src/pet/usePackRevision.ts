import { useEffect, useState } from "react";
import { onPackImported } from "../lib/packs";

export function usePackRevision(packId: string, subscribe = onPackImported): string {
  const [revisions, setRevisions] = useState<Readonly<Record<string, string>>>({});
  useEffect(() => {
    let disposed = false;
    const listener = subscribe((pack) => {
      if (!disposed) setRevisions((current) => ({ ...current, [pack.packId]: pack.sha256 }));
    });
    return () => { disposed = true; void listener.then((stop) => stop()); };
  }, [subscribe]);
  return revisions[packId] ?? "";
}
