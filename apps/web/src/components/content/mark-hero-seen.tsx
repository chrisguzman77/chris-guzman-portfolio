"use client";

import { useEffect, useLayoutEffect } from "react";

import { HERO_SEEN_COOKIE } from "@/lib/hero";

// Set once the typing has played in this page session. Back/forward can remount the page from a
// cached payload that still says animate, which would replay it.
let played = false;

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function MarkHeroSeen() {
  useIsomorphicLayoutEffect(() => {
    if (played) document.documentElement.dataset.heroSeen = "";
    else played = true;
  }, []);
  useEffect(() => {
    const secure = window.location.protocol === "https:" ? "; secure" : "";
    document.cookie = `${HERO_SEEN_COOKIE}=1; path=/; samesite=lax${secure}`;
  }, []);
  return null;
}
