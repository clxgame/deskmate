export function localWorklogDate(now = new Date()): string {
  const date = new Date(now);
  if (date.getHours() < 3) date.setDate(date.getDate() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
