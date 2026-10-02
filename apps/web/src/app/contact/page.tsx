import { ExternalLink, Mail } from "lucide-react";
import type { Metadata } from "next";

import { ContactForm } from "@/components/contact/contact-form";
import { CopyEmail } from "@/components/content/copy-email";
import { PageHeader } from "@/components/content/page-header";
import { GitHubIcon, LinkedInIcon } from "@/components/icons/brand";
import { getProfile } from "@/lib/directus/queries";
import { serverEnv } from "@/lib/env";
import { siteConfig } from "@/lib/site";

export const metadata: Metadata = {
  title: "Contact",
  description: "Email, LinkedIn, and GitHub for Christopher Guzman.",
  alternates: { canonical: "/contact" },
};

const FALLBACK_EMAIL = "chguzman@augusta.edu";

const rowClass = "flex items-center gap-3 rounded-[10px] border border-border bg-card px-3.5 py-3";
const iconClass =
  "inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-brand/15 text-accent-brand";
const valueClass = "break-all font-mono text-[11px] text-muted-foreground";
const openClass =
  "ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-md border border-input px-2.5 py-1.5 text-xs text-foreground transition-colors hover:bg-background";

function lastPathSegment(url: string): string {
  return new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? url;
}

export default async function ContactPage() {
  const profile = await getProfile();
  const { turnstileSiteKey, publicApiUrl } = serverEnv();
  const email = profile?.email || FALLBACK_EMAIL;
  // ProfileSchema turns empty or non-http(s) URLs into null, so they fall back here.
  const linkedin = profile?.linkedin_url ?? siteConfig.links.linkedin;
  const github = profile?.github_url ?? siteConfig.links.github;

  return (
    <div className="mx-auto w-full max-w-5xl px-6 pb-16">
      <PageHeader prompt="$ ping chris" title="Get in touch" />
      <div className="mt-4 grid items-start gap-4 md:grid-cols-[1.7fr_1fr]">
        <section
          aria-labelledby="contact-form-heading"
          className="rounded-[10px] border border-border bg-card p-5"
        >
          <h2 id="contact-form-heading" className="mb-4 text-[15px] font-semibold">
            Send a message
          </h2>
          {turnstileSiteKey ? (
            <ContactForm apiUrl={publicApiUrl} siteKey={turnstileSiteKey} fallbackEmail={email} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Contact form coming soon. Email me directly.
            </p>
          )}
        </section>

        <section aria-labelledby="contact-direct">
          <h2 id="contact-direct" className="sr-only">
            Other ways to reach me
          </h2>
          <ul className="flex flex-col gap-2.5">
            <li className={rowClass}>
              <span className={iconClass}>
                <Mail className="size-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">Email</h3>
                <p className={valueClass}>{email}</p>
              </div>
              <div className="ml-auto shrink-0">
                <CopyEmail email={email} />
              </div>
            </li>
            <li className={rowClass}>
              <span className={iconClass}>
                <LinkedInIcon className="size-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">LinkedIn</h3>
                <p className={valueClass}>{lastPathSegment(linkedin)}</p>
              </div>
              <a
                href={linkedin}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open LinkedIn profile"
                className={openClass}
              >
                <ExternalLink className="size-3.5" aria-hidden />
                Open
              </a>
            </li>
            <li className={rowClass}>
              <span className={iconClass}>
                <GitHubIcon className="size-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">GitHub</h3>
                <p className={valueClass}>@{lastPathSegment(github)}</p>
              </div>
              <a
                href={github}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open GitHub profile"
                className={openClass}
              >
                <ExternalLink className="size-3.5" aria-hidden />
                Open
              </a>
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
