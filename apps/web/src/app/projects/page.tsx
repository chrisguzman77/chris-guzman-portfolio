import type { Metadata } from "next";

import { EmptyState } from "@/components/content/empty-state";
import { PageHeader } from "@/components/content/page-header";
import { ProjectCard } from "@/components/content/project-card";
import { SectionHeading } from "@/components/content/section-heading";
import { getProjects } from "@/lib/directus/queries";
import { sectionNumbers } from "@/lib/format";

export const metadata: Metadata = { title: "Projects" };

const SECTIONS = [
  { type: "personal", title: "Personal projects" },
  { type: "competition", title: "Competitions" },
] as const;

function countLabel(n: number): string {
  return `${n} ${n === 1 ? "project" : "projects"}`;
}

export default async function ProjectsPage() {
  const projects = await getProjects();
  const groups = SECTIONS.map((section) => ({
    ...section,
    items: projects.filter((p) => p.type === section.type),
  })).filter((group) => group.items.length > 0);
  const numbers = sectionNumbers(groups.map((group) => group.type));

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <PageHeader prompt="$ ls projects/" title="Projects" />
      {groups.length === 0 ? (
        <div className="mt-6">
          <EmptyState>No projects published yet.</EmptyState>
        </div>
      ) : (
        groups.map((group) => (
          <section key={group.type} className="mt-8">
            <SectionHeading
              number={numbers[group.type]}
              title={group.title}
              count={countLabel(group.items.length)}
            />
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.items.map((project) => (
                <ProjectCard key={project.id} project={project} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
