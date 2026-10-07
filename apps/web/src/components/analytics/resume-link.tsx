"use client";

import type { ReactNode } from "react";

import { track } from "@/lib/analytics";

// The PDF link, the only thing that counts as a resume download. Links to the /resume page
// are plain <Link>s: tracking them too counted one visitor twice (link, then PDF).
// Tracked with track() rather than data-umami-event: Umami's declarative handler cancels
// same-tab clicks and sets location.href, which would break `download`.
export function ResumeLink({
  href,
  download,
  className,
  children,
}: {
  href: string;
  download?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      download={download}
      className={className}
      onClick={() => track("resume-download", { from: window.location.pathname })}
    >
      {children}
    </a>
  );
}
