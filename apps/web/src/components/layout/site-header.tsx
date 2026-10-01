import Link from "next/link";

import { siteConfig } from "@/lib/site";

import { MobileNav } from "./mobile-nav";
import { NavLink } from "./nav-link";
import { ThemeToggle } from "./theme-toggle";

export function SiteHeader() {
  return (
    <header className="relative border-b border-border">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-8 px-6 font-mono text-xs">
        <Link href="/" className="shrink-0 text-accent-brand hover:opacity-80">
          ~/chris-guzman<span className="sr-only"> (Christopher Guzman, home)</span>
        </Link>
        <div className="flex items-center gap-4">
          <nav aria-label="Main" className="hidden items-center gap-4 md:flex">
            {siteConfig.nav.map((item) => (
              <NavLink key={item.href} href={item.href}>
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-1 md:border-l md:border-input md:pl-3">
            <ThemeToggle />
            <MobileNav />
          </div>
        </div>
      </div>
    </header>
  );
}
