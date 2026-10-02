import Link from "next/link";

import { PageHeader } from "@/components/content/page-header";

const LINKS = [
  { href: "/", label: "home" },
  { href: "/projects", label: "projects" },
  { href: "/blog", label: "blog" },
  { href: "/contact", label: "contact" },
] as const;

export default function NotFound() {
  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <PageHeader prompt="$ cd: no such page" title="Page not found" />
      <nav aria-label="Main pages">
        <ul className="flex flex-wrap gap-3">
          {LINKS.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="inline-flex items-center rounded-md border border-input px-3.5 py-2 font-mono text-sm text-foreground transition-colors hover:bg-card"
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
