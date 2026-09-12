export interface WorklogWeek {
  readonly year: number;
  readonly number: number;
  readonly start: string;
  readonly end: string;
}

export function weekForDate(value: string): WorklogWeek {
  const monday = new Date(`${value}T12:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
  const thursday = new Date(monday);
  thursday.setUTCDate(thursday.getUTCDate() + 3);
  const year = thursday.getUTCFullYear();
  const first = new Date(Date.UTC(year, 0, 4, 12));
  first.setUTCDate(first.getUTCDate() - (first.getUTCDay() + 6) % 7);
  const number = Math.round((monday.getTime() - first.getTime()) / 604800000) + 1;
  const sunday = new Date(monday);
  sunday.setUTCDate(sunday.getUTCDate() + 6);
  return { year, number, start: monday.toISOString().slice(0, 10), end: sunday.toISOString().slice(0, 10) };
}

export function weeksForYear(year: number): readonly WorklogWeek[] {
  const first = weekForDate(`${year}-01-04`);
  return Array.from({ length: weekForDate(`${year}-12-28`).number }, (_, index) => {
    const date = new Date(`${first.start}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + index * 7);
    return weekForDate(date.toISOString().slice(0, 10));
  });
}

export function weekLabel(week: WorklogWeek, template: string): string {
  const shortDate = (value: string) => `${Number(value.slice(5, 7))}.${Number(value.slice(8, 10))}`;
  return template.replace("{week}", String(week.number)).replace("{range}", `${shortDate(week.start)}-${shortDate(week.end)}`);
}
