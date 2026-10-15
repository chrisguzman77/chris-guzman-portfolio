import { LogoPath } from "./logo-path";
import { MainNav } from "./main-nav";
import { MobileNav } from "./mobile-nav";
import { ThemeToggle } from "./theme-toggle";

export function SiteHeader() {
  return (
    <header className="relative border-b border-border">
      <div className="mx-auto flex min-h-(--site-header-h) max-w-5xl items-center justify-between gap-8 px-6 py-2 font-mono text-xs">
        <LogoPath />
        <div className="flex shrink-0 items-center gap-4">
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
