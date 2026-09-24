export type WorkbenchHistoryHost = {
  readonly core: { invoke(command: "show_history_organizer"): Promise<void> };
};

export async function handleHistoryShortcut(
  event: KeyboardEvent,
  invoke: WorkbenchHistoryHost["core"]["invoke"],
): Promise<void> {
  if (event.code !== "KeyH" || !event.ctrlKey || !event.altKey || event.shiftKey || event.metaKey || event.repeat || event.isComposing) return;
  event.preventDefault();
  await invoke("show_history_organizer");
}
