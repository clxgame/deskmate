export function PomodoroCountdown({ remainingMs }: { readonly remainingMs: number | null }) {
  const seconds = Math.ceil((remainingMs ?? 0) / 1000);
  const remaining = remainingMs === null ? "--:--"
    : `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  return (
    <svg viewBox="0 0 152 48" width="3.8em" height="1.2em" focusable="false"
      style={{ display: "block", maxWidth: "100%", overflow: "visible" }}>
      <text x="0" y="38" fill="currentColor" fontSize="40" fontWeight="500"
        fontFamily={'"Segoe UI", "Microsoft YaHei", system-ui, sans-serif'}
        style={{ fontVariantNumeric: "tabular-nums" }}>{remaining}</text>
    </svg>
  );
}
