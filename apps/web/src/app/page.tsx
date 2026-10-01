import Image from "next/image";
import Link from "next/link";

import { ExperienceEntry } from "@/components/content/experience-entry";
import { LiveStatus } from "@/components/content/live-status";
import { PostListItem } from "@/components/content/post-list-item";
import { ProjectCard } from "@/components/content/project-card";
import { SectionHeading } from "@/components/content/section-heading";
import { GitHubIcon, LinkedInIcon } from "@/components/icons/brand";
import { getExperience, getPosts, getProfile, getProjects } from "@/lib/directus/queries";
import { sectionNumbers } from "@/lib/format";
import { siteConfig } from "@/lib/site";

type HomeSection = "projects" | "experience" | "blog";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-brand";
const primaryButton = `inline-flex items-center gap-2 rounded-md bg-accent-brand px-3.5 py-2 text-[13px] font-semibold text-accent-brand-foreground transition-opacity hover:opacity-90 ${focusRing}`;
const outlineButton = `inline-flex items-center gap-2 rounded-md border border-input px-3.5 py-2 text-[13px] text-foreground transition-colors hover:bg-card ${focusRing}`;
const ghostLink = `inline-flex items-center gap-2 rounded-md py-2 pr-2.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground ${focusRing}`;

export default async function HomePage() {
  const [profile, projects, experience, posts] = await Promise.all([
    getProfile(),
    getProjects(),
    getExperience(),
    getPosts(),
  ]);

  const name = profile?.name ?? siteConfig.name;
  const githubUrl = profile?.github_url ?? siteConfig.links.github;
  const linkedinUrl = profile?.linkedin_url ?? siteConfig.links.linkedin;

  const featured = projects.filter((p) => p.featured).slice(0, 3);
  const homeRoles = experience.filter((e) => e.show_on_home);
  const latestPosts = posts.slice(0, 3);

  const visible: HomeSection[] = [];
  if (featured.length > 0) visible.push("projects");
  if (homeRoles.length > 0) visible.push("experience");
  if (latestPosts.length > 0) visible.push("blog");
  const numbers = sectionNumbers(visible);

  return (
    <div className="mx-auto max-w-5xl px-6">
      <section className="grid gap-6 py-12 md:grid-cols-[1.35fr_1fr] md:items-center md:gap-8 md:py-16">
        {/* Narrow screens: `contents` lifts these blocks into the grid so order-1/2/3 puts the
            photo between the name and the intro. md+: a normal left column beside the photo. */}
        <div className="contents md:block">
          <div className="order-1">
            <p className="font-mono text-xs text-accent-brand">$ whoami</p>
            <h1 className="mt-2.5 text-4xl font-semibold leading-[1.05] tracking-tight md:text-[46px]">
              {name}
            </h1>
          </div>
          <div className="order-3 md:mt-4">
            {profile?.intro ? (
              <p className="mb-4 max-w-[46ch] text-[15.5px] leading-relaxed text-muted-foreground">
                {profile.intro}
              </p>
            ) : null}
            <div className="mb-5">
              <LiveStatus />
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              <Link href="/resume" className={primaryButton}>
                Download resume
              </Link>
              <Link href="/contact" className={outlineButton}>
                Get in touch
              </Link>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2.5">
              <a href={githubUrl} target="_blank" rel="noopener noreferrer" className={ghostLink}>
                <GitHubIcon className="size-4" aria-hidden="true" />
                GitHub
              </a>
              <a href={linkedinUrl} target="_blank" rel="noopener noreferrer" className={ghostLink}>
                <LinkedInIcon className="size-4" aria-hidden="true" />
                LinkedIn
              </a>
            </div>
          </div>
        </div>
        <Image
          src="/images/chris.jpg"
          alt="Portrait of Christopher Guzman"
          width={788}
          height={985}
          preload
          sizes="(min-width: 768px) 360px, 300px"
          className="order-2 aspect-[4/5] h-auto w-full max-w-[300px] rounded-[10px] border border-input object-cover md:max-w-none"
        />
      </section>

      {featured.length > 0 ? (
        <section className="border-t border-border py-9">
          <SectionHeading
            number={numbers.projects}
            title="Featured projects"
            href="/projects"
            linkLabel="all projects"
          />
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {featured.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        </section>
      ) : null}

      {homeRoles.length > 0 ? (
        <section className="border-t border-border py-9">
          <SectionHeading
            number={numbers.experience}
            title="Experience"
            href="/experience"
            linkLabel="full history"
          />
          <ol className="mt-2 divide-y divide-dashed divide-border">
            {homeRoles.map((entry) => (
              <li key={entry.id} className="py-2.5">
                <ExperienceEntry entry={entry} compact />
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {latestPosts.length > 0 ? (
        <section className="border-t border-border py-9">
          <SectionHeading number={numbers.blog} title="Blog" href="/blog" linkLabel="all posts" />
          <ol className="mt-2 divide-y divide-dashed divide-border">
            {latestPosts.map((post) => (
              <li key={post.id}>
                <PostListItem post={post} />
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
