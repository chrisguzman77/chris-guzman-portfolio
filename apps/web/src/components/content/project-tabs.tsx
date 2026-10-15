import Link from "next/link";

import { outboundProps } from "@/lib/analytics";
import { cn } from "@/lib/utils";

const tab =
  "inline-flex shrink-0 items-center gap-1 border-r border-border px-3.5 py-2 font-mono text-xs focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-brand";
const inactive = "text-muted-foreground transition-colors hover:bg-card hover:text-foreground";

function ExternalTab({ href, label }: { href: string; label: "repo" | "live" }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(tab, inactive)}
      {...outboundProps(label)}
    >
      {label} <span aria-hidden="true">↗</span>
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

// Project page header styled as an editor's tab bar: this page is the open README.md; the repo
// and live site are the other "tabs". Links, not ARIA tabs: each one navigates.
export function ProjectTabs({
  slug,
  repoUrl,
  liveUrl,
}: {
  slug: string;
  repoUrl: string | null;
  liveUrl: string | null;
}) {
  return (
    <nav
      aria-label="Project links"
      className="flex overflow-x-auto rounded-t-[10px] border-b border-border"
    >
      <Link
        href={`/projects/${slug}`}
        aria-current="page"
        className={cn(tab, "bg-card text-foreground shadow-[inset_0_2px_0_var(--accent-brand)]")}
      >
        README.md
      </Link>
      {repoUrl ? <ExternalTab href={repoUrl} label="repo" /> : null}
      {liveUrl ? <ExternalTab href={liveUrl} label="live" /> : null}
    </nav>
  );
}
