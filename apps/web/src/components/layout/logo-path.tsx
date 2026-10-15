"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { logoCrumb, logoSuffix, nextFrame } from "@/lib/logo-path";

const TYPE_MS = 35;
const HOME_LINK =
  "text-accent-brand hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-brand";

// A 404 under a real section (/projects/nope) can't be told apart by its path, so the
// not-found page flags itself through this tiny store while it is mounted.
let notFound = false;
const listeners = new Set<() => void>();
function setNotFound(value: boolean) {
  notFound = value;
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function MarkNotFound() {
  useEffect(() => {
    setNotFound(true);
    return () => setNotFound(false);
  }, []);
  return null;
}

// The whole header logo: the home link (accessible name "~/chris-guzman (Christopher Guzman,
// home)"), on a document the link to its section, and the decorative typed path.
export function LogoPath() {
  const pathname = usePathname();
  const isNotFound = useSyncExternalStore(
    subscribe,
    () => notFound,
    () => false,
  );
  const target = isNotFound ? "/404" : logoSuffix(pathname);
  const [shown, setShown] = useState(target);
  const shownRef = useRef(target);

  useEffect(() => {
    if (shownRef.current === target) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setInterval(
      () => {
        const next = reduced ? target : nextFrame(shownRef.current, target);
        shownRef.current = next;
        setShown(next);
        if (next === target) window.clearInterval(timer);
      },
      reduced ? 0 : TYPE_MS,
    );
    return () => window.clearInterval(timer);
  }, [target]);

  const crumb = logoCrumb(target);
  // Once the typed text has reached the whole section prefix it becomes a link to that list.
  const linked = crumb !== null && shown.startsWith(crumb) ? crumb : null;
  const rest = linked ? shown.slice(linked.length) : shown;

  return (
    <span className="min-w-0 break-all">
      <Link href="/" aria-label="~/chris-guzman (Christopher Guzman, home)" className={HOME_LINK}>
        ~/chris-guzman
      </Link>
      {/* Hidden at 768-1023px: the six desktop nav links share the row there. */}
      <span data-logo-suffix="" className="text-foreground md:max-lg:hidden">
        {linked ? (
          <Link
            href={linked}
            aria-label={`${linked.slice(1)} folder`}
            className="hover:underline hover:underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-brand"
          >
            {linked}
          </Link>
        ) : null}
        <span aria-hidden="true">{rest}</span>
      </span>
      <span aria-hidden="true" className="logo-caret" />
    </span>
  );
}
