import Link from "next/link";

import type { Project } from "@/lib/directus/schemas";

import { AwardBadge } from "./award-badge";
import { TechTags } from "./tech-tags";

export function ProjectCard({ project }: { project: Project }) {
  return (
    <Link
      href={`/projects/${project.slug}`}
      className="flex h-full flex-col rounded-[10px] border border-border bg-card p-4 transition-colors hover:border-input focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-brand"
    >
      <h3 className="mb-1.5 text-[15px] font-semibold">{project.title}</h3>
      <p className="mb-2.5 text-[13px] leading-normal text-muted-foreground">{project.summary}</p>
      <TechTags tags={project.tech} />
      {/* After the title in the DOM so the link's name starts with its visible title; shown first. */}
      {project.award && (
        <div className="order-first mb-2">
          <AwardBadge award={project.award} />
        </div>
      )}
    </Link>
  );
}
