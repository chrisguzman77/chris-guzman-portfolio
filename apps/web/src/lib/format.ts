import type { Experience } from "@/lib/directus/schemas";

// Directus dates are "YYYY-MM-DD". Parse and format in UTC so output never shifts by a day.
function utcDate(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`);
}

const postDate = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

const monthYear = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export function formatPostDate(iso: string): string {
  return postDate.format(utcDate(iso));
}

export function formatMonthYear(iso: string): string {
  return monthYear.format(utcDate(iso));
}

export function formatRange(start: string, end: string | null): string {
  return `${formatMonthYear(start)} – ${end ? formatMonthYear(end) : "Present"}`;
}

export function isCurrent(entry: { end_date: string | null }): boolean {
  return entry.end_date === null;
}

export function sortExperience(list: Experience[]): Experience[] {
  return [...list].sort(
    (a, b) =>
      Number(isCurrent(b)) - Number(isCurrent(a)) || b.start_date.localeCompare(a.start_date),
  );
}

export function graduationLabel(endIso: string, today: Date = new Date()): string {
  const label = formatMonthYear(endIso);
  return utcDate(endIso) > today ? `Expected ${label}` : label;
}

export function sectionNumbers<T extends string>(visible: T[]): Record<T, string> {
  return Object.fromEntries(
    visible.map((key, index) => [key, String(index + 1).padStart(2, "0")]),
  ) as Record<T, string>;
}
