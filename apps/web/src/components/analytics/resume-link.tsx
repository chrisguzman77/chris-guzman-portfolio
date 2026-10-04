"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { track } from "@/lib/analytics";

// Tracked with track() rather than data-umami-event: Umami's declarative handler cancels
// same-tab clicks and sets location.href, which would break `download` and client navigation.
export function ResumeLink({
  kind,
  href,
  download,
  className,
  children,
}: {
  kind: "page" | "file";
  href: string;
  download?: string;
  className?: string;
  children: ReactNode;
}) {
  const onClick = () => track("resume-download", { from: window.location.pathname });
  return kind === "page" ? (
    <Link href={href} className={className} onClick={onClick}>
      {children}
    </Link>
  ) : (
    <a href={href} download={download} className={className} onClick={onClick}>
      {children}
    </a>
  );
}
