import { Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/content/empty-state";
import { ExperienceEntry } from "@/components/content/experience-entry";
import { PageHeader } from "@/components/content/page-header";
import { getExperience } from "@/lib/directus/queries";
import { outlineButton } from "@/lib/styles";

export const metadata: Metadata = { title: "Experience" };

export default async function ExperiencePage() {
  const entries = await getExperience();

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <PageHeader prompt="$ cat experience.log" title="Experience" />
      <h2 className="sr-only">All roles</h2>
      <div className="mt-4">
        {entries.length > 0 ? (
          <ol className="divide-y divide-dashed divide-border">
            {entries.map((entry) => (
              <li key={entry.id}>
                <ExperienceEntry entry={entry} />
              </li>
            ))}
          </ol>
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
