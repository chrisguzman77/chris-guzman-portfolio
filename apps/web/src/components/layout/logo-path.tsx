"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { logoSuffix, nextFrame } from "@/lib/logo-path";

const TYPE_MS = 35;

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

// The header logo's live path (~/chris-guzman + this). Decorative: the link's accessible
// name stays "~/chris-guzman (Christopher Guzman, home)".
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

  return (
    // Hidden at 768-1023px: the six desktop nav links share the row there and a long path would overflow.
    <span aria-hidden="true" className="md:max-lg:hidden">
      <span data-logo-suffix="" className="text-foreground">
        {shown}
      </span>
      <span className="logo-caret" />
    </span>
  );
}
