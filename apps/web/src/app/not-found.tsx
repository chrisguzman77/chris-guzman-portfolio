import Link from "next/link";

import { PageHeader } from "@/components/content/page-header";
import { MarkNotFound } from "@/components/layout/logo-path";
import { NotFoundTerminal } from "@/components/layout/not-found-terminal";
import { siteConfig } from "@/lib/site";

const LINKS = [{ href: "/", label: "home" }, ...siteConfig.nav];

export default function NotFound() {
  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <MarkNotFound />
      <PageHeader prompt="$ cd: no such page" title="Page not found" />
      <NotFoundTerminal />
      <nav aria-label="Main pages" className="mt-6">
        <ul className="flex flex-wrap gap-3">
          {LINKS.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="inline-flex items-center rounded-md border border-input px-3.5 py-2 font-mono text-sm text-foreground transition-colors hover:bg-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-brand"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
