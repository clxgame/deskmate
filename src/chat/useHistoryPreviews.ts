import { useEffect, useRef, useState, type RefObject } from "react";
import { catalogPreviews, type CatalogPreview, type UnifiedHistoryRow } from "../lib/unifiedHistory";

/** Loads only rows touching the scroll viewport, plus roughly two rows below. */
export function useHistoryPreviews(items: readonly UnifiedHistoryRow[], scrollRoot: RefObject<HTMLDivElement | null>) {
  const [previews, setPreviews] = useState<ReadonlyMap<string, CatalogPreview>>(() => new Map());
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    const requested = new Set<string>();
    const pending: string[] = [];
    let active = 0;
    let closed = false;
    let queued: ReturnType<typeof setTimeout> | undefined;
    setPreviews(new Map());
    const pump = () => {
      if (closed || current !== generation.current) return;
      while (active < 2 && pending.length) {
        const key = pending.shift();
        if (!key) continue;
        active++;
        void catalogPreviews([key]).then(values => {
          if (closed || current !== generation.current) return;
          const preview = Array.isArray(values) ? values.find(value => value.key === key) : undefined;
          setPreviews(previous => new Map(previous).set(key, preview ?? { key, status: "unavailable", text: null, role: null, time: null, localOnly: false }));
        }).catch(() => {
          if (!closed && current === generation.current) setPreviews(previous => new Map(previous).set(key, { key, status: "unavailable", text: null, role: null, time: null, localOnly: false }));
        }).finally(() => { active--; pump(); });
      }
    };
    const enqueue = (key: string) => {
      if (requested.has(key)) return;
      requested.add(key);
      pending.push(key);
      if (pending.length > 12) {
        const dropped = pending.shift();
        if (dropped) requested.delete(dropped);
      }
      if (queued) clearTimeout(queued);
      queued = setTimeout(pump, 20);
    };
    const root = scrollRoot.current;
    let observer: IntersectionObserver | undefined;
    if (root && typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
          const key = (entry.target as HTMLElement).dataset.previewKey;
          if (!key) continue;
          if (entry.isIntersecting) {
            enqueue(key);
          } else {
            const index = pending.indexOf(key);
            if (index >= 0) {
              pending.splice(index, 1);
              requested.delete(key);
            }
          }
        }
      }, { root, rootMargin: "0px 0px 144px 0px" });
      root.querySelectorAll<HTMLElement>("[data-preview-key]").forEach(element => observer?.observe(element));
    } else {
      // DOM test environments without IntersectionObserver still exercise the
      // same bounded first-screen request path.
      for (const row of items.slice(0, 8)) enqueue(row.key);
    }
    return () => { closed = true; generation.current++; observer?.disconnect(); if (queued) clearTimeout(queued); };
  }, [items, scrollRoot]);
  return previews;
}
