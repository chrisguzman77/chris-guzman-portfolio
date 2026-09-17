import Link from "next/link";

import { siteConfig } from "@/lib/site";

import { ThemeToggle } from "./theme-toggle";

export function SiteHeader() {
  return (
    <header className="border-b border-border/60">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
        <Link href="/" className="font-display text-lg tracking-tight">
          {siteConfig.name}
        </Link>
        <ThemeToggle />
      </div>
    </header>
  );
}
