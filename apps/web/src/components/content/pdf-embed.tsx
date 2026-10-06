"use client";

import { useSyncExternalStore } from "react";

import { ResumeLink } from "@/components/analytics/resume-link";

// Keep in step with the `md:` breakpoint of the wrapper in /resume.
const DESKTOP_QUERY = "(min-width: 768px)";

function subscribe(onChange: () => void) {
  const query = window.matchMedia(DESKTOP_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
const isDesktop = () => window.matchMedia(DESKTOP_QUERY).matches;
const serverSnapshot = () => false;

// The <object> only exists on wide screens: a `hidden` object still fetches its PDF, which
// would cost mobile visitors the whole file for nothing. Server render and the first client
// render both omit it, so there is no hydration mismatch.
export function PdfEmbed({ src }: { src: string }) {
  const desktop = useSyncExternalStore(subscribe, isDesktop, serverSnapshot);
  if (!desktop) return null;
  return (
    <object
      data={src}
      type="application/pdf"
      aria-label="Resume of Christopher Guzman (PDF)"
      className="h-[80vh] w-full rounded"
    >
      <p className="p-6 text-sm text-muted-foreground">
        Your browser cannot show the PDF here.{" "}
        <ResumeLink href={src} className="text-accent-brand underline-offset-4 hover:underline">
          Open the resume PDF
        </ResumeLink>
        .
      </p>
    </object>
  );
}
