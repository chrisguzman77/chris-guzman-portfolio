import { ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AwardBadge } from "@/components/content/award-badge";
import { PageHeader } from "@/components/content/page-header";
import { Prose } from "@/components/content/prose";
import { TechTags } from "@/components/content/tech-tags";
import { GitHubIcon } from "@/components/icons/brand";
import { outboundProps } from "@/lib/analytics";
import { getProject } from "@/lib/directus/queries";
import type { Project } from "@/lib/directus/schemas";
import { formatMonthYear } from "@/lib/format";
import { renderMarkdown } from "@/lib/markdown";
import { outlineButton } from "@/lib/styles";

type Props = { params: Promise<{ slug: string }> };

const TYPE_LABELS: Record<Project["type"], string> = {
  personal: "Personal project",
  competition: "Competition",
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const project = await getProject(slug);
  if (!project) return {};
  return { title: project.title, description: project.summary };
}

export default async function ProjectPage({ params }: Props) {
  const { slug } = await params;
  const project = await getProject(slug);
  if (!project) notFound();

  const body = project.body ? await renderMarkdown(project.body) : null;
  const meta = project.date
    ? `${TYPE_LABELS[project.type]} · ${formatMonthYear(project.date)}`
    : TYPE_LABELS[project.type];

  return (
    <article className="mx-auto max-w-5xl px-6 py-10">
      <PageHeader prompt={`$ cat projects/${project.slug}.md`} title={project.title} />
      {project.award ? (
        <div className="mt-3">
          <AwardBadge award={project.award} />
        </div>
      ) : null}
      <p className="mt-3 font-mono text-xs text-muted-foreground">{meta}</p>
      {project.tech.length > 0 ? (
        <div className="mt-2">
          <TechTags tags={project.tech} />
        </div>
      ) : null}

      {project.repo_url || project.live_url ? (
        <div className="mt-5 flex flex-wrap gap-2.5">
          {project.repo_url ? (
            <a
              href={project.repo_url}
              target="_blank"
              rel="noopener noreferrer"
              className={outlineButton}
              {...outboundProps("repo")}
            >
              <GitHubIcon className="size-4" aria-hidden="true" />
              Source code
            </a>
          ) : null}
          {project.live_url ? (
            <a
              href={project.live_url}
              target="_blank"
              rel="noopener noreferrer"
              className={outlineButton}
              {...outboundProps("live")}
            >
              <ExternalLink className="size-4" aria-hidden="true" />
              Live site
            </a>
          ) : null}
        </div>
      ) : null}

      {project.cover ? (
        <div className="relative mt-8 aspect-video overflow-hidden rounded-[10px] border border-border">
          {/* unoptimized: /cms-assets already serves immutable, CDN-cached files, and the
              384 MB web container should not resize arbitrary CMS uploads with sharp. */}
          <Image
            src={`/cms-assets/${project.cover}`}
            alt={`${project.title} cover image`}
            fill
            unoptimized
            sizes="(min-width: 1024px) 976px, 100vw"
            className="object-cover"
          />
        </div>
      ) : null}

      {body ? (
        <div className="mt-8">
          <Prose html={body.html} />
        </div>
      ) : null}

      <div className="mt-10 border-t border-border pt-4">
        <Link href="/projects" className={outlineButton}>
          ← all projects
        </Link>
      </div>
    </article>
  );
}
