import { Activity, BarChart3, FileText, Mail } from "lucide-react";
import type { Metadata } from "next";
import type { ComponentType } from "react";

import { PageHeader } from "@/components/content/page-header";
import { requireAccess } from "@/lib/cf-access";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

type Tool = {
  name: string;
  href: string;
  description: string;
  Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
};

// Each tool is its own Cloudflare Access application with the same policy, so one PIN
// login opens all of them.
const TOOLS: Tool[] = [
  {
    name: "Subscribers",
    href: "/admin/subscribers",
    description: "Newsletter subscribers: list and remove.",
    Icon: Mail,
  },
  {
    name: "Content",
    href: "https://cms.christopherguzman.me",
    description: "Directus: posts, projects, resume, and Email to subscribers.",
    Icon: FileText,
  },
  {
    name: "Monitoring",
    href: "https://grafana.christopherguzman.me",
    description: "Grafana: system health, alerts, and the Newsletter dashboard.",
    Icon: Activity,
  },
  {
    name: "Analytics",
    href: "https://analytics.christopherguzman.me",
    description: "Umami: visitors, pages, and newsletter visits.",
    Icon: BarChart3,
  },
];

const cardClass =
  "flex items-start gap-3 rounded-[10px] border border-border bg-card px-4 py-3.5 transition-colors hover:bg-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-brand";
const iconClass =
  "inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-brand/15 text-accent-brand";

export default async function AdminPage() {
  await requireAccess();
  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <PageHeader prompt="$ ls admin/" title="Admin" />
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {TOOLS.map(({ name, href, description, Icon }) => (
          <li key={name}>
            <a href={href} className={cardClass}>
              <span className={iconClass}>
                <Icon className="size-4" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-foreground">{name}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
