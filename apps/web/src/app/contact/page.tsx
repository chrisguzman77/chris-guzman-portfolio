import { ExternalLink, Mail } from "lucide-react";
import type { Metadata } from "next";

import { CopyEmail } from "@/components/content/copy-email";
import { PageHeader } from "@/components/content/page-header";
import { GitHubIcon, LinkedInIcon } from "@/components/icons/brand";
import { getProfile } from "@/lib/directus/queries";
import { siteConfig } from "@/lib/site";

export const metadata: Metadata = {
  title: "Contact",
  description: "Email, LinkedIn, and GitHub for Christopher Guzman.",
  alternates: { canonical: "/contact" },
};

const FALLBACK_EMAIL = "chguzman@augusta.edu";

const cardClass =
  "flex flex-col items-start gap-1.5 rounded-[10px] border border-border bg-card p-4";
const iconClass =
  "mb-1 inline-flex size-9 items-center justify-center rounded-lg bg-accent-brand/15 text-accent-brand";
const valueClass = "mb-2 break-all font-mono text-xs text-muted-foreground";
const openClass =
  "inline-flex items-center gap-2 rounded-md border border-input px-3.5 py-2 text-sm text-foreground transition-colors hover:bg-background";

function lastPathSegment(url: string): string {
  return new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? url;
}

export default async function ContactPage() {
  const profile = await getProfile();
  const email = profile?.email || FALLBACK_EMAIL;
  // ProfileSchema turns empty or non-http(s) URLs into null, so they fall back here.
  const linkedin = profile?.linkedin_url ?? siteConfig.links.linkedin;
  const github = profile?.github_url ?? siteConfig.links.github;

  return (
    <div className="mx-auto w-full max-w-5xl px-6 pb-16">
      <PageHeader prompt="$ ping chris" title="Get in touch" />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3">
        <section className={cardClass} aria-labelledby="contact-email">
          <span className={iconClass}>
            <Mail className="size-[18px]" aria-hidden />
          </span>
          <h2 id="contact-email" className="text-[15px] font-semibold">
            Email
          </h2>
          <p className={valueClass}>{email}</p>
          <CopyEmail email={email} />
        </section>

        <section className={cardClass} aria-labelledby="contact-linkedin">
          <span className={iconClass}>
            <LinkedInIcon className="size-[18px]" aria-hidden />
          </span>
          <h2 id="contact-linkedin" className="text-[15px] font-semibold">
            LinkedIn
          </h2>
          <p className={valueClass}>{lastPathSegment(linkedin)}</p>
          <a
            href={linkedin}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open LinkedIn profile"
            className={openClass}
          >
            <ExternalLink className="size-4" aria-hidden />
            Open
          </a>
        </section>

        <section className={cardClass} aria-labelledby="contact-github">
          <span className={iconClass}>
            <GitHubIcon className="size-[18px]" aria-hidden />
          </span>
          <h2 id="contact-github" className="text-[15px] font-semibold">
            GitHub
          </h2>
          <p className={valueClass}>@{lastPathSegment(github)}</p>
          <a
            href={github}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open GitHub profile"
            className={openClass}
          >
            <ExternalLink className="size-4" aria-hidden />
            Open
          </a>
        </section>
      </div>
    </div>
  );
}
