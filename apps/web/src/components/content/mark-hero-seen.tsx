"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

// Set once the hero has mounted in this document: back/forward or a later visit in the same tab
// must not replay the typing.
let played = false;

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

// The prompt types on a refresh or a fresh visit: the first mount in a document that the browser
// loaded at "/". Reaching home by clicking a link (the document was loaded at another path) or
// coming back to it later renders the final state instead.
export function shouldAnimateHero(
  initialPath: string | null,
  alreadyPlayed: boolean,
  navigationType: string | null = null,
): boolean {
  if (alreadyPlayed || navigationType === "back_forward") return false;
  return initialPath === null || initialPath === "/";
}

function initialDocument(): { path: string | null; type: string | null } {
  const [entry] = performance.getEntriesByType?.("navigation") ?? [];
  const nav = entry as PerformanceNavigationTiming | undefined;
  return nav ? { path: new URL(nav.name).pathname, type: nav.type } : { path: null, type: null };
}

export function MarkHeroSeen() {
  const decided = useRef(false); // StrictMode runs effects twice in dev; decide once per mount
  useIsomorphicLayoutEffect(() => {
    if (decided.current) return;
    decided.current = true;
    // Before paint, so a remount never shows a frame of the animation.
    const { path, type } = initialDocument();
    if (!shouldAnimateHero(path, played, type)) {
      document.documentElement.dataset.heroSeen = "";
    }
    played = true;
  }, []);
  return null;
}
