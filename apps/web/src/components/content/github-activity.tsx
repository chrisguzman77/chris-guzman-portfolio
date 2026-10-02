import { formatPostDate } from "@/lib/format";
import type { Activity, ActivityDay } from "@/lib/github-activity";
import { cn } from "@/lib/utils";

export const MOBILE_WEEKS = 22;

// Empty plus four strengths of the accent, in both themes (semantic tokens only).
const LEVEL_CLASS = [
  "bg-muted",
  "bg-accent-brand/25",
  "bg-accent-brand/45",
  "bg-accent-brand/70",
  "bg-accent-brand",
] as const;

const monthFormat = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });

function utc(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function plural(count: number): string {
  return count === 1 ? "contribution" : "contributions";
}

export function contributionTitle(day: ActivityDay): string {
  const date = formatPostDate(day.date);
  return day.count === 0
    ? `No contributions on ${date}`
    : `${day.count} ${plural(day.count)} on ${date}`;
}

// GitHub weeks start on Sunday; the first and last week of the year can be partial.
function slots(days: ActivityDay[]): (ActivityDay | null)[] {
  const out: (ActivityDay | null)[] = Array.from({ length: 7 }, () => null);
  for (const day of days) out[utc(day.date).getUTCDay()] = day;
  return out;
}

function monthLabels(weeks: Activity["weeks"]): (string | null)[] {
  let previous = "";
  return weeks.map((week) => {
    const first = week.days[0];
    if (!first) return null;
    const month = monthFormat.format(utc(first.date));
    if (month === previous) return null;
    previous = month;
    return month;
  });
}

export function GitHubActivity({
  activity,
  profileUrl,
}: {
  activity: Activity;
  profileUrl: string;
}) {
  const { weeks, total } = activity;
  const totalText = total.toLocaleString("en-US");
  const labels = monthLabels(weeks);
  const olderThanMobile = (index: number) => index < weeks.length - MOBILE_WEEKS;

  return (
    <a
      href={profileUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`GitHub profile: ${totalText} ${plural(total)} in the last year (opens in a new tab)`}
      className="block rounded-[10px] border border-border bg-card p-4 transition-colors hover:border-input focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-brand"
    >
      <div
        aria-hidden="true"
        className="mb-1.5 flex gap-[3px] font-mono text-[10px] text-muted-foreground"
      >
        {labels.map((month, index) => (
          <span
            key={weeks[index].days[0]?.date ?? index}
            className={cn(
              "flex-1 overflow-visible whitespace-nowrap",
              olderThanMobile(index) && "hidden md:block",
            )}
          >
            {month ?? ""}
          </span>
        ))}
      </div>
      <div
        role="img"
        aria-label={`${totalText} GitHub ${plural(total)} in the last year`}
        className="flex gap-[3px]"
      >
        {weeks.map((week, index) => (
          <div
            key={week.days[0]?.date ?? index}
            className={cn(
              "flex flex-1 flex-col gap-[3px]",
              olderThanMobile(index) && "hidden md:flex",
            )}
          >
            {slots(week.days).map((day, slot) =>
              day ? (
                <span
                  key={day.date}
                  title={contributionTitle(day)}
                  className={cn("aspect-square rounded-[2px]", LEVEL_CLASS[day.level])}
                />
              ) : (
                <span key={`empty-${slot}`} className="aspect-square" />
              ),
            )}
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-[11px] text-muted-foreground">
          {`${totalText} ${plural(total)} in the last year · updated hourly`}
        </p>
        <div
          aria-hidden="true"
          className="flex items-center gap-1 text-[10px] text-muted-foreground"
        >
          less
          {LEVEL_CLASS.map((level) => (
            <span key={level} className={cn("size-[9px] rounded-[2px]", level)} />
          ))}
          more
        </div>
      </div>
    </a>
  );
}
