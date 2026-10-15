"use client";

import { useEffect } from "react";

import { HERO_SEEN_COOKIE } from "@/lib/hero";

export function MarkHeroSeen() {
  useEffect(() => {
    const secure = window.location.protocol === "https:" ? "; secure" : "";
    document.cookie = `${HERO_SEEN_COOKIE}=1; path=/; samesite=lax${secure}`;
  }, []);
  return null;
}
