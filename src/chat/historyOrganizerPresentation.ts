import type { UnifiedHistoryRow } from "../lib/unifiedHistory";
import type { HistoryCopy } from "./historyOrganizerCopy";

function parts(path: string): string[] {
  return path.split(/[\\/]+/).filter(Boolean);
}

export function projectLabels(rows: readonly UnifiedHistoryRow[], copy: HistoryCopy, knownDirectories: readonly string[] = []): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  const directories = [...new Set([...knownDirectories, ...rows.flatMap(row => row.identity.kind === "native" ? [row.identity.directory] : [])])];
  for (const directory of directories) {
    const path = parts(directory);
    const simple = path.at(-1) ?? directory;
    const name = rows.some(row => row.identity.kind === "native" && row.identity.directory === directory && row.source === "light_chat" && simple === "workspace")
      ? copy.light_chat : simple;
    const collision = directories.some(other => other !== directory && (parts(other).at(-1) ?? other) === simple);
    names.set(directory, collision ? `${path.at(-2) ?? "…"}/${name}` : name);
  }
  return names;
}

export function groupName(row: UnifiedHistoryRow, now: Date, copy: HistoryCopy): string {
  if (row.pinned) return copy.pinnedGroup;
  const date = new Date(row.updated);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date >= today) return copy.today;
  if (date >= yesterday) return copy.yesterday;
  return copy.earlier;
}

export function timeLabel(updated: number, group: string, now: Date, language: string, copy: HistoryCopy): string {
  const date = new Date(updated);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (group === copy.today || group === copy.yesterday || (group === copy.pinnedGroup && date >= today)) {
    return new Intl.DateTimeFormat(language, { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  }
  return new Intl.DateTimeFormat(language, { month: "numeric", day: "numeric", ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }) }).format(date);
}

export function groupedRows(rows: readonly UnifiedHistoryRow[], now: Date, copy: HistoryCopy): readonly { name: string; rows: UnifiedHistoryRow[] }[] {
  const groups: { name: string; rows: UnifiedHistoryRow[] }[] = [];
  for (const row of rows) {
    const name = groupName(row, now, copy);
    const last = groups.at(-1);
    if (last?.name === name) last.rows.push(row);
    else groups.push({ name, rows: [row] });
  }
  return groups;
}
