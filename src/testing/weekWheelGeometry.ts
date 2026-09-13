// Happy DOM has no layout/scroll snapping. Only event-contract tests use this
// geometry; alignment and native input are separately verified in Chromium.
export function measureWeekWheel(list: HTMLElement) {
  Object.defineProperty(list, "clientHeight", { configurable: true, value: 180 });
  list.getBoundingClientRect = () => new DOMRect(0, 0, 320, 180);
  const rows = Array.from(list.querySelectorAll<HTMLElement>('[role="option"]'));
  rows.forEach((row, index) => {
    row.getBoundingClientRect = () => new DOMRect(0, 72 + index * 36 - list.scrollTop, 320, 36);
  });
  list.scrollTop = Number(list.querySelector('[aria-selected="true"]')?.id.split("-").at(-1)) * 36;
  list.scrollTo = (options?: ScrollToOptions | number, y?: number) => {
    list.scrollTop = typeof options === "number" ? y ?? 0 : options?.top ?? list.scrollTop;
  };
  return list;
}
