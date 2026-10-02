import Link from "next/link";

const linkClass = "shrink-0 text-xs text-muted-foreground transition-colors hover:text-foreground";

export function SectionHeading({
  number,
  title,
  href,
  linkLabel,
  count,
  id,
}: {
  number: string;
  title: string;
  href?: string;
  linkLabel?: string;
  count?: string;
  id?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <h2 id={id} className="text-xl font-semibold tracking-tight">
        <span
          aria-hidden="true"
          className="mr-2 font-mono text-[13px] font-normal text-accent-brand"
        >
          {number}
        </span>
        {title}
      </h2>
      {href && linkLabel ? (
        href.startsWith("http") ? (
          <a href={href} target="_blank" rel="noopener noreferrer" className={linkClass}>
            {linkLabel}
            <span aria-hidden="true"> →</span>
          </a>
        ) : (
          <Link href={href} className={linkClass}>
            {linkLabel}
            <span aria-hidden="true"> →</span>
          </Link>
        )
      ) : count ? (
        <span className="shrink-0 font-mono text-xs text-muted-foreground">{count}</span>
      ) : null}
    </div>
  );
}
