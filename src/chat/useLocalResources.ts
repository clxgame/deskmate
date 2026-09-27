import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { discardChatResources, parseLocalResources, pickChatResources, readLegacyResource, stageMediaResource, usesLegacyAttachment, type LocalResource } from "./localResources";

// Only unbound references and app-owned upload copies are removed by this command.
const discard = (resources: readonly LocalResource[]) => {
  void discardChatResources(resources.map(resource => resource.id)).catch(() => {});
};

type Options = {
  readonly scopeKey: string;
  readonly active: boolean;
  readonly useLegacyFiles: boolean;
  readonly onLegacyFiles: (files: readonly File[]) => void;
  readonly onError: (message: string) => void;
};

export function useLocalResources(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const generation = useRef(0);
  const resourcesRef = useRef<readonly LocalResource[]>([]);
  const [resources, setResources] = useState<readonly LocalResource[]>([]);
  const [pending, setPending] = useState(false);
  const pendingCount = useRef(0);

  const update = useCallback((next: readonly LocalResource[]) => {
    resourcesRef.current = next;
    setResources(next);
  }, []);
  useLayoutEffect(() => {
    generation.current += 1;
    update([]);
    pendingCount.current = 0;
    setPending(false);
    return () => { generation.current += 1; discard(resourcesRef.current); };
  }, [options.scopeKey, update]);

  const receive = useCallback(async (load: () => Promise<readonly LocalResource[]>) => {
    if (!latest.current.active) return;
    const token = generation.current;
    pendingCount.current += 1;
    setPending(true);
    try {
      const received = await load();
      if (token !== generation.current || !latest.current.active) { discard(received); return; }
      const legacy = latest.current.useLegacyFiles ? received.filter(usesLegacyAttachment) : [];
      const references = received.filter(resource => !legacy.includes(resource));
      if (references.length) {
        const byId = new Map(resourcesRef.current.map(resource => [resource.id, resource]));
        const excess: LocalResource[] = [];
        for (const resource of references) {
          if (byId.size < 32 || byId.has(resource.id)) byId.set(resource.id, resource);
          else excess.push(resource);
        }
        update([...byId.values()]);
        if (excess.length) { discard(excess); latest.current.onError("resource_selection_too_many"); }
      }
      // Read legacy sources sequentially to bound decoded memory for multi-file drops.
      for (const resource of legacy) {
        try {
          const file = await readLegacyResource(resource.id);
          if (token !== generation.current || !latest.current.active) { discard(legacy); return; }
          latest.current.onLegacyFiles([file]);
        } catch (cause) {
          if (token === generation.current) latest.current.onError(cause instanceof Error ? cause.message : String(cause));
        } finally {
          discard([resource]);
        }
      }
    } catch (cause) {
      if (token === generation.current) latest.current.onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (token === generation.current) { pendingCount.current -= 1; setPending(pendingCount.current > 0); }
    }
  }, [update]);

  useEffect(() => {
    let disposed = false;
    const unlisteners: (() => void)[] = [];
    const subscriptions = [
      listen<unknown>("chat-resources-dropped", event => {
        try {
          const values = parseLocalResources(event.payload);
          if (latest.current.active) void receive(async () => values);
          else discard(values);
        } catch (cause) {
          if (latest.current.active) latest.current.onError(cause instanceof Error ? cause.message : String(cause));
        }
      }),
      listen<string>("chat-resources-error", event => { if (latest.current.active) latest.current.onError(event.payload); }),
    ];
    for (const subscription of subscriptions) void subscription.then(unlisten => { if (disposed) unlisten(); else unlisteners.push(unlisten); }).catch(() => {});
    return () => { disposed = true; for (const unlisten of unlisteners) unlisten(); };
  }, [receive]);

  const pick = useCallback((title: string, directory = false) => pendingCount.current > 0 ? Promise.resolve() : receive(() => pickChatResources(title, directory)), [receive]);
  const addMediaFiles = useCallback((files: readonly File[]) => {
    const token = generation.current;
    return receive(async () => {
      const values: LocalResource[] = [];
      for (const file of files) {
        if (token !== generation.current || !latest.current.active) break;
        try { values.push(await stageMediaResource(file)); }
        catch (cause) {
          if (token === generation.current && latest.current.active) latest.current.onError(cause instanceof Error ? cause.message : String(cause));
        }
      }
      return values;
    });
  }, [receive]);
  const remove = useCallback((id: string) => {
    discard(resourcesRef.current.filter(resource => resource.id === id));
    update(resourcesRef.current.filter(resource => resource.id !== id));
  }, [update]);
  const clearSent = useCallback((ids: readonly string[]) => {
    const sent = new Set(ids);
    update(resourcesRef.current.filter(resource => !sent.has(resource.id)));
  }, [update]);
  return { resources, pending, pick, addMediaFiles, remove, clearSent };
}
