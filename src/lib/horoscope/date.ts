/** A local calendar key; UTC conversion is deliberately absent here. */
export function localDateKey(now: Date): string {
  if (Number.isNaN(now.getTime())) throw new RangeError("Invalid date");
  const year = now.getFullYear().toString().padStart(4, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Calendar day ordinal, independent of the machine's time zone. */
export function calendarDayOrdinal(dateKey: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) throw new RangeError(`Invalid horoscope date: ${dateKey}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(0);
  utc.setUTCHours(0, 0, 0, 0);
  utc.setUTCFullYear(year, month - 1, day);
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) {
    throw new RangeError(`Invalid horoscope date: ${dateKey}`);
  }
  return Math.floor(utc.getTime() / 86_400_000);
}

/** Uses local calendar arithmetic, so a daylight-saving day may be 23 or 25 hours. */
export function nextLocalMidnight(now: Date): Date {
  if (Number.isNaN(now.getTime())) throw new RangeError("Invalid date");
  const midnight = new Date(now.getTime());
  // Move through noon so a rare midnight clock change on the current day
  // cannot shift the following calendar date.
  midnight.setHours(12, 0, 0, 0);
  midnight.setDate(midnight.getDate() + 1);
  midnight.setHours(0, 0, 0, 0);
  return midnight;
}
