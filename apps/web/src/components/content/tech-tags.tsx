export function TechTags({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;
  return <p className="font-mono text-[11px] text-accent-brand">{tags.join(" · ")}</p>;
}
