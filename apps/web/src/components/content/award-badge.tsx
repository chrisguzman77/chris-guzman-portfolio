import { Trophy } from "lucide-react";

export function AwardBadge({ award }: { award: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-[10px] border border-accent-brand px-2.5 py-0.5 text-[11px] leading-snug text-accent-brand">
      <Trophy aria-hidden="true" className="size-[13px] shrink-0" />
      <span>{award}</span>
    </span>
  );
}
