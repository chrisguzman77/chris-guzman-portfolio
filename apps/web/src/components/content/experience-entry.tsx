import { MapPin } from "lucide-react";

import type { Experience } from "@/lib/directus/schemas";
import { formatRange, isCurrent } from "@/lib/format";

import { CurrentPill } from "./current-pill";
import { TechTags } from "./tech-tags";

export function ExperienceEntry({
  entry,
  compact = false,
}: {
  entry: Experience;
  compact?: boolean;
}) {
  return (
    <article className="py-4">
      <h3 className="text-[15.5px] font-semibold">{entry.company}</h3>
      <p className="mt-0.5 text-[14.5px] text-foreground/85">
        {entry.role}
        {isCurrent(entry) && <CurrentPill />}
      </p>
      <p className="mt-1 flex flex-wrap items-center gap-x-2.5 font-mono text-[11.5px] text-muted-foreground">
        <span>{formatRange(entry.start_date, entry.end_date)}</span>
        <span aria-hidden="true">·</span>
        <span className="inline-flex items-center gap-1">
          <MapPin aria-hidden="true" className="size-3" />
          <span>{entry.location}</span>
        </span>
      </p>
      {!compact && entry.highlights.length > 0 && (
        <ul className="my-2 list-disc space-y-1 pl-[18px] text-[13.5px] leading-relaxed text-foreground/85">
          {entry.highlights.map((highlight, index) => (
            <li key={`${index}-${highlight}`}>{highlight}</li>
          ))}
        </ul>
      )}
      {!compact && <TechTags tags={entry.tech} />}
    </article>
  );
}
