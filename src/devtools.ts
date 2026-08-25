export function shouldLoadReactDevTools(
  isDevelopment: boolean,
  disabled: string | undefined,
): boolean {
  return isDevelopment && disabled !== "1";
}

if (
  shouldLoadReactDevTools(
    import.meta.env.DEV,
    import.meta.env.VITE_DISABLE_REACT_DEVTOOLS,
  )
) {
  void import("react-grab");
  void import("react-scan").then(({ scan }) => scan({ enabled: true }));
}
