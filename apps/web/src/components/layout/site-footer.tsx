import { Rss } from "lucide-react";

import { GitHubIcon, LinkedInIcon } from "@/components/icons/brand";
import { siteConfig } from "@/lib/site";

const iconLink = "text-muted-foreground transition-colors hover:text-foreground";

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-6 font-mono text-[11.5px] text-muted-foreground">
        <p>{`© ${new Date().getFullYear()} ${siteConfig.name}`}</p>
        <nav aria-label="Social links" className="flex items-center gap-3">
          <a
            href={siteConfig.links.github}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub"
            className={iconLink}
          >
            <GitHubIcon className="size-4" />
          </a>
          <a
            href={siteConfig.links.linkedin}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="LinkedIn"
            className={iconLink}
          >
            <LinkedInIcon className="size-4" />
          </a>
          <a href="/blog/rss.xml" aria-label="RSS feed" className={iconLink}>
            <Rss className="size-4" aria-hidden="true" />
          </a>
        </nav>
      </div>
    </footer>
  );
}
