import { useEffectEvent, useLayoutEffect, type RefObject } from "react";
import type { WorklogWeek } from "./worklogWeek";

interface WeekWheelOptions {
  readonly listRef: RefObject<HTMLDivElement | null>;
  readonly weeks: readonly WorklogWeek[];
  readonly selected: WorklogWeek;
  readonly onChange: (week: WorklogWeek) => void;
  readonly onFinish: () => void;
  readonly onCandidate: (index: number) => void;
}

export function useWeekWheel({ listRef, weeks, selected, onChange, onFinish, onCandidate }: WeekWheelOptions) {
  const change = useEffectEvent(onChange);
  const finish = useEffectEvent(onFinish);
  const candidate = useEffectEvent(onCandidate);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const rows = Array.from(list.querySelectorAll<HTMLElement>('[role="option"]'));
    let pending = false;
    let committed = selected.start;
    let cursor = selected.number - 1;
    let intent: number | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let suppressClick = false;
    let held = false;
    let drag: { readonly id: number; readonly y: number; readonly top: number; moved: boolean } | null = null;
    const clamp = (index: number) => Math.max(0, Math.min(rows.length - 1, index));
    const target = (index: number) => {
      const row = rows[index];
      if (!row || !list.clientHeight) return null;
      const rect = row.getBoundingClientRect();
      if (!rect.height) return null;
      return rect.top - list.getBoundingClientRect().top + list.scrollTop + rect.height / 2 - list.clientHeight / 2;
    };
    const nearest = () => {
      const first = target(0);
      const height = rows[0]?.getBoundingClientRect().height;
      return first === null || !height ? cursor : clamp(Math.round((list.scrollTop - first) / height));
    };
    const update = (index: number) => { cursor = index; candidate(index); };
    const clearTimer = () => { clearTimeout(timer); timer = undefined; };
    const publish = () => {
      clearTimer();
      pending = false;
      intent = null;
      const week = weeks[cursor];
      if (week && week.start !== committed) { committed = week.start; change(week); }
    };
    const settle = () => {
      clearTimer();
      if (!pending || held) return;
      update(intent ?? nearest());
      const top = target(cursor);
      if (top === null) return;
      if (Math.abs(list.scrollTop - top) > 1) {
        list.scrollTo({ top, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
        arm();
        return;
      }
      publish();
    };
    const arm = () => { clearTimer(); timer = setTimeout(settle, 180); };
    const seek = (index: number, immediate = false) => {
      intent = clamp(index);
      update(intent);
      const top = target(cursor);
      if (top === null) return;
      pending = true;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      list.scrollTo({ top, behavior: immediate || reduced ? "instant" : "smooth" });
      arm();
    };
    const release = () => {
      if (drag && list.hasPointerCapture(drag.id)) list.releasePointerCapture(drag.id);
      drag = null;
      held = false;
      delete list.dataset.dragging;
    };
    const sync = () => {
      clearTimer();
      pending = false;
      intent = null;
      release();
      update(selected.number - 1);
      const top = target(cursor);
      if (top !== null) list.scrollTo({ top, behavior: "instant" });
    };
    const scroll = () => {
      update(nearest());
      if (pending) arm();
    };
    const wheel = () => { intent = null; pending = true; arm(); };
    const click = (event: MouseEvent) => {
      if (suppressClick) { suppressClick = false; return; }
      if (!(event.target instanceof Element)) return;
      const row = event.target.closest<HTMLElement>('[role="option"]');
      const index = row ? rows.indexOf(row) : -1;
      if (index >= 0) { list.focus({ preventScroll: true }); seek(index); }
    };
    const key = (event: KeyboardEvent) => {
      const from = intent ?? cursor;
      const index = { ArrowUp: from - 1, ArrowDown: from + 1, Home: 0, End: rows.length - 1 }[event.key];
      if (index !== undefined) { event.preventDefault(); seek(index); }
      if (event.key === "Enter") {
        event.preventDefault();
        seek(from, true);
        if (target(cursor) !== null) publish();
        finish();
      }
    };
    const down = (event: PointerEvent) => {
      suppressClick = false;
      held = true;
      if (event.pointerType !== "mouse") { wheel(); return; }
      if (event.button !== 0) { held = false; return; }
      event.preventDefault();
      list.focus({ preventScroll: true });
      drag = { id: event.pointerId, y: event.clientY, top: list.scrollTop, moved: false };
    };
    const move = (event: PointerEvent) => {
      if (!drag || drag.id !== event.pointerId) return;
      const delta = drag.y - event.clientY;
      if (!drag.moved && Math.abs(delta) <= 4) return;
      drag.moved = true;
      list.dataset.dragging = "true";
      list.setPointerCapture(drag.id);
      pending = true;
      intent = null;
      list.scrollTo({ top: drag.top + delta, behavior: "instant" });
      update(nearest());
    };
    const up = () => {
      const mouse = drag !== null;
      suppressClick = drag?.moved ?? false;
      release();
      if (pending) {
        if (mouse) seek(nearest());
        else arm();
      }
    };
    const cancel = () => { suppressClick = true; sync(); };
    sync();
    list.focus({ preventScroll: true });
    list.addEventListener("scroll", scroll);
    list.addEventListener("scrollend", settle);
    list.addEventListener("wheel", wheel, { passive: true });
    list.addEventListener("click", click);
    list.addEventListener("keydown", key);
    list.addEventListener("pointerdown", down);
    list.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", cancel);
    let width = list.clientWidth;
    let height = list.clientHeight;
    const resize = new ResizeObserver(() => {
      if (width === list.clientWidth && height === list.clientHeight) return;
      width = list.clientWidth;
      height = list.clientHeight;
      sync();
    });
    resize.observe(list);
    return () => {
      clearTimer();
      pending = false;
      release();
      resize.disconnect();
      list.removeEventListener("scroll", scroll);
      list.removeEventListener("scrollend", settle);
      list.removeEventListener("wheel", wheel);
      list.removeEventListener("click", click);
      list.removeEventListener("keydown", key);
      list.removeEventListener("pointerdown", down);
      list.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", cancel);
    };
  }, [listRef, selected.start, selected.number, weeks]);
}
