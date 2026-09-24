export type WorkbenchThemeHost = {
  core: { invoke(command: "workbench_theme"): Promise<string> };
  event: { listen(name: "deskmate://theme-changed", handler: (event: { payload: string }) => void): Promise<() => void> };
};

export type ThemeSyncError = (phase: "listen" | "read", error: unknown) => void;

export async function syncWorkbenchTheme(
  host: WorkbenchThemeHost,
  apply: (theme: string) => void,
  report: ThemeSyncError,
): Promise<void> {
  try {
    await host.event.listen("deskmate://theme-changed", (event) => apply(event.payload));
  } catch (error) {
    report("listen", error);
  }
  try {
    apply(await host.core.invoke("workbench_theme"));
  } catch (error) {
    report("read", error);
  }
}
