import { Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { ResumeLink } from "@/components/analytics/resume-link";
import { EmptyState } from "@/components/content/empty-state";
import { PageHeader } from "@/components/content/page-header";
import { getResume } from "@/lib/directus/queries";
import { formatPostDate } from "@/lib/format";

export const metadata: Metadata = {
  title: "Resume",
  description: "Download the resume of Christopher Guzman as a PDF.",
  alternates: { canonical: "/resume" },
};

export default async function ResumePage() {
  const resume = await getResume();

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <PageHeader prompt="$ open resume.pdf" title="Resume" />
      {resume?.file ? (
        <ResumeViewer
          src={`/cms-assets/${resume.file}`}
          versionLabel={resume.version_label}
          updatedAt={resume.updated_at}
        />
      ) : (
        <EmptyState>
          Resume coming soon.{" "}
          <Link href="/experience" className="text-accent-brand underline-offset-4 hover:underline">
            Read the experience page
          </Link>
        </EmptyState>
      )}
    </div>
  );
}

function ResumeViewer({
  src,
  versionLabel,
  updatedAt,
}: {
  src: string;
  versionLabel: string | null;
  updatedAt: string | null;
}) {
  const meta = [
    versionLabel ? `version ${versionLabel}` : null,
    updatedAt ? `updated ${formatPostDate(updatedAt)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-[15px] font-semibold">Christopher Guzman, Resume</p>
          {meta ? <p className="mt-0.5 font-mono text-xs text-muted-foreground">{meta}</p> : null}
        </div>
        <ResumeLink
          kind="file"
          href={src}
          download="christopher-guzman-resume.pdf"
          className="inline-flex items-center gap-2 rounded-md bg-accent-brand px-3.5 py-2 text-sm font-semibold text-accent-brand-foreground transition-opacity hover:opacity-90"
        >
          <Download className="size-4" aria-hidden />
          Download PDF
        </ResumeLink>
      </div>
      <div className="hidden rounded-[10px] border border-border bg-card p-4 md:block">
        <object
          data={src}
          type="application/pdf"
          aria-label="Resume of Christopher Guzman (PDF)"
          className="h-[80vh] w-full rounded"
        >
          <p className="p-6 text-sm text-muted-foreground">
            Your browser cannot show the PDF here.{" "}
            <ResumeLink
              kind="file"
              href={src}
              className="text-accent-brand underline-offset-4 hover:underline"
            >
              Open the resume PDF
            </ResumeLink>
            .
          </p>
        </object>
      </div>
    </>
  );
}
