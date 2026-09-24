# Shared conversation history entry

The YUME tray menu contains **全部对话记录**. It opens and focuses the same organizer in the light-chat window even while the workbench is foreground. The workbench's own project sidebar remains unchanged.

In the workbench, press **Ctrl+Alt+H** to open that organizer. This shortcut is local to the workbench window; holding the key, composing text, or adding Shift/Meta does not repeatedly open it. The tray entry remains available outside the workbench.

The host command `show_history_organizer` accepts no arguments and permits only the `chat` and `workbench` window labels. The workbench's generated YUME bridge invokes it; pinned upstream source is not modified by this entry. Browser pages without the Tauri bridge cannot invoke it.

The host keeps a pending open request, reveals the chat window, and emits `history://open` with a null payload to `chat`. The chat installs its event listener first, then calls `consume_history_organizer_request` once on mount and on each event. Only `chat` can consume this boolean request. This preserves a click made before the organizer listener mounts and avoids duplicate opens. Opening the organizer does not select, clone, create, send to, or change input ownership of a session.

After choosing a row, the shared organizer uses the native session's directory and ID to route it through the existing chat/workbench handoff. Session access and mutation capabilities are evaluated by the shared history layer.

To reproduce the packaged bridge, run the standard `bun run prepare:workbench` and `bun run build` steps. The existing generated `yume-theme-bridge.js` includes the keyboard binding. No upstream DOM selector is needed.
