"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

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

// The document section ("/blog", "/projects") that the displayed text is still inside, or null.
// Only while a "/" follows it: the bare section name at rest is plain text.
function shownSection(shown: string): string | null {
  const match = /^\/([a-z]+)\//.exec(shown);
  return match && logoCrumb(`/${match[1]}/x.md`) ? `/${match[1]}` : null;
}

// Text split after each "/" with a <wbr /> break opportunity after each slash.
function breakable(text: string) {
  return text.split(/(?<=\/)/).map((part, i) => (
    <Fragment key={i}>
      {part}
      {part.endsWith("/") ? <wbr /> : null}
    </Fragment>
  ));
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

  // Once the typed text has reached the whole section prefix it becomes a link to that list.
  // The link outlives navigation until the text has been deleted past the prefix, so a
  // keyboard user who just activated it keeps a focus target during the animation.
  const crumb = logoCrumb(target) ?? shownSection(shown);
  const linked = crumb !== null && shown.startsWith(crumb) ? crumb : null;
  const rest = linked ? shown.slice(linked.length) : shown;
  const lastSlash = rest.lastIndexOf("/") + 1;

  const homeRef = useRef<HTMLAnchorElement>(null);
  const sectionFocused = useRef(false);
  useLayoutEffect(() => {
    if (linked === null && sectionFocused.current) {
      sectionFocused.current = false;
      homeRef.current?.focus();
    }
  }, [linked]);

  return (
    <span className="min-w-0 wrap-anywhere">
      <Link
        ref={homeRef}
        href="/"
        aria-label="~/chris-guzman (Christopher Guzman, home)"
        className={`${HOME_LINK} whitespace-nowrap`}
      >
        ~/chris-guzman
      </Link>
      {/* Hidden at 768-1023px: the six desktop nav links share the row there. */}
      <span data-logo-suffix="" className="text-foreground md:max-lg:hidden">
        <wbr />
        {linked ? (
          <Link
            href={linked}
            aria-label={`${linked.slice(1)} folder`}
            onFocus={() => {
              sectionFocused.current = true;
            }}
            onBlur={(e) => {
              // Removal from the DOM can fire blur too; only a real focus move clears the flag.
              if (e.currentTarget.isConnected) sectionFocused.current = false;
            }}
            className="hover:underline hover:underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-brand"
          >
            {linked}
          </Link>
        ) : null}
        <span aria-hidden="true">
          {breakable(rest.slice(0, lastSlash))}
          <span className="whitespace-nowrap">{rest.slice(lastSlash)}</span>
        </span>
      </span>
      <span aria-hidden="true" className="logo-caret" />
    </span>
  );
}
