import { ExternalLink, GraduationCap } from "lucide-react";
import type { Metadata } from "next";

import { EmptyState } from "@/components/content/empty-state";
import { PageHeader } from "@/components/content/page-header";
import { SectionHeading } from "@/components/content/section-heading";
import { outboundProps } from "@/lib/analytics";
import { getCertifications, getEducation, getInvolvement } from "@/lib/directus/queries";
import type { Education } from "@/lib/directus/schemas";
import { formatMonthYear, graduationLabel, sectionNumbers } from "@/lib/format";

export const metadata: Metadata = {
  title: "Education",
  description: "Degrees, coursework, involvement, and certifications of Christopher Guzman.",
};

type EducationSection = "involvement" | "coursework" | "certifications";

const card = "rounded-[10px] border border-border bg-card p-4";

function SchoolCard({ school }: { school: Education }) {
  return (
    <article className={card}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-brand/10 text-accent-brand">
          <GraduationCap className="size-[18px]" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold">{school.school}</h2>
          <p className="mt-0.5 text-[13.5px] text-muted-foreground">{school.location}</p>
        </div>
        <span className="font-mono text-xs text-muted-foreground sm:ml-auto">
          {graduationLabel(school.end_date)}
        </span>
      </div>
      {school.degrees.length > 0 ? (
        <dl className="mt-3.5 grid gap-1.5 text-sm">
          {school.degrees.map((degree) => (
            <div key={`${degree.kind}-${degree.name}`} className="flex gap-2">
              <dt className="w-16 shrink-0 font-mono text-xs leading-5 text-muted-foreground">
                {degree.kind}
              </dt>
              <dd>{degree.name}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </article>
  );
}

export default async function EducationPage() {
  const [education, involvement, certifications] = await Promise.all([
    getEducation(),
    getInvolvement(),
    getCertifications(),
  ]);
  const coursework = [...new Set(education.flatMap((school) => school.coursework))];

  const visible: EducationSection[] = [];
  if (involvement.length > 0) visible.push("involvement");
  if (coursework.length > 0) visible.push("coursework");
  if (certifications.length > 0) visible.push("certifications");
  const numbers = sectionNumbers(visible);

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <PageHeader prompt="$ cat education.md" title="Education" />

      <div className="mt-4 grid gap-3">
        {education.length > 0 ? (
          education.map((school) => <SchoolCard key={school.id} school={school} />)
        ) : (
          <EmptyState>No education published yet.</EmptyState>
        )}
      </div>

      {involvement.length > 0 ? (
        <section className="mt-10">
          <SectionHeading number={numbers.involvement} title="Involvement" />
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {involvement.map((item) => (
              <li key={item.id} className={card}>
                <h3 className="text-[15px] font-semibold">{item.organization}</h3>
                <p className="mt-0.5 text-[13.5px] text-muted-foreground">
                  {`${item.role} · ${item.year}`}
                </p>
                {item.summary ? (
                  <p className="mt-2 text-[13px] text-muted-foreground">{item.summary}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {coursework.length > 0 ? (
        <section className="mt-10">
          <SectionHeading number={numbers.coursework} title="Relevant coursework" />
          <ul className="mt-3 flex flex-wrap gap-2">
            {coursework.map((course) => (
              <li
                key={course}
                className="rounded-full border border-input px-3 py-1 font-mono text-xs text-muted-foreground"
              >
                {course}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {certifications.length > 0 ? (
        <section className="mt-10">
          <SectionHeading number={numbers.certifications} title="Certifications" />
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {certifications.map((cert) => (
              <li key={cert.id} className={card}>
                <h3 className="text-[15px] font-semibold">{cert.name}</h3>
                <p className="mt-0.5 text-[13.5px] text-muted-foreground">
                  {cert.date ? `${cert.issuer} · ${formatMonthYear(cert.date)}` : cert.issuer}
                </p>
                {cert.url ? (
                  <a
                    href={cert.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 inline-flex items-center gap-1.5 rounded font-mono text-xs text-accent-brand hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-brand"
                    {...outboundProps("other")}
                  >
                    View credential
                    <ExternalLink className="size-3.5" aria-hidden="true" />
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
