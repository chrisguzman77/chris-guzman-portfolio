import { Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/content/empty-state";
import { ExperienceEntry } from "@/components/content/experience-entry";
import { PageHeader } from "@/components/content/page-header";
import { Timeline } from "@/components/content/timeline";
import { getExperience } from "@/lib/directus/queries";
import { pageMetadata } from "@/lib/metadata";
import { outlineButton } from "@/lib/styles";

export const metadata: Metadata = pageMetadata({
  title: "Experience",
  description: "Roles, internships, and leadership experience of Christopher Guzman.",
  path: "/experience",
});

export default async function ExperiencePage() {
  const entries = await getExperience();

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <PageHeader prompt="$ cat experience.log" title="Experience" />
      <h2 className="sr-only">All roles</h2>
      <div className="mt-4">
        {entries.length > 0 ? (
          <Timeline>
            {entries.map((entry) => (
              <li key={entry.id}>
                <ExperienceEntry entry={entry} />
              </li>
            ))}
          </Timeline>
        ) : (
          <EmptyState>No roles published yet.</EmptyState>
        )}
      </div>
      <div className="mt-6">
        <Link href="/resume" className={outlineButton}>
          <Download className="size-4" aria-hidden="true" />
          Download full resume
        </Link>
      </div>
    </div>
  );
}
