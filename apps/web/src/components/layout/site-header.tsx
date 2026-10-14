import Link from "next/link";

import { LogoPath } from "./logo-path";
import { MainNav } from "./main-nav";
import { MobileNav } from "./mobile-nav";
import { ThemeToggle } from "./theme-toggle";

export function SiteHeader() {
  return (
    <header className="relative border-b border-border">
      <div className="mx-auto flex h-(--site-header-h) max-w-5xl items-center justify-between gap-8 px-6 font-mono text-xs">
        <Link
          href="/"
          className="shrink-0 text-accent-brand hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-brand"
        >
          ~/chris-guzman
          <LogoPath /> <span className="sr-only">(Christopher Guzman, home)</span>
        </Link>
        <div className="flex items-center gap-4">
          <MainNav />
          <div className="flex items-center gap-1 md:border-l md:border-input md:pl-3">
            <ThemeToggle />
            <MobileNav />
          </div>
        </div>
      </div>
    </header>
  );
}
