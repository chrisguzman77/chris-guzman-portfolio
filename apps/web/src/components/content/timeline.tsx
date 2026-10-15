"use client";

import { type ReactNode, useEffect, useRef } from "react";

// Entries light, and the line reaches, this far down the viewport.
const LIGHT_AT = 0.65;
// Distance from an entry's top to its dot's centre (matches .timeline > li::before in globals.css).
const DOT_CENTER = 24;

// How far the LIGHT_AT line has moved down a list whose top is `top` px from the viewport top.
export function timelineProgress(top: number, height: number, viewport: number): number {
  if (height <= 0) return 1;
  return Math.min(1, Math.max(0, (viewport * LIGHT_AT - top) / height));
}

// /experience: a mint line grows down the list as the visitor scrolls and each entry's dot lights
// as it passes. Without JS or with reduced motion the list keeps its final state (full line, every
// dot lit), because the CSS only dims anything once data-timeline-ready is set.
export function Timeline({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const list = ref.current;
    if (!list || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const el = list;
    let frame = 0;

    function update() {
      frame = 0;
      const items = Array.from(el.children) as HTMLElement[];
      const rect = el.getBoundingClientRect();
      const tops = items.map((item) => item.getBoundingClientRect().top);
      const doc = document.documentElement;
      const atBottom = window.innerHeight + window.scrollY >= doc.scrollHeight - 2;
      const progress = atBottom ? 1 : timelineProgress(rect.top, rect.height, window.innerHeight);
      const last = tops.at(-1);
      el.style.setProperty("--timeline-progress", String(Math.round(progress * 100) / 100));
      if (last !== undefined) {
        el.style.setProperty("--timeline-end", `${rect.height - (last - rect.top) - DOT_CENTER}px`);
      }
      items.forEach((item, index) => {
        if (atBottom || tops[index] < window.innerHeight * LIGHT_AT) item.dataset.lit = "";
      });
    }
    function schedule() {
      if (!frame) frame = window.requestAnimationFrame(update);
    }

    update(); // light what is already in view before dimming the rest: no flicker
    el.dataset.timelineReady = "";
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <ol ref={ref} className="timeline divide-y divide-dashed divide-border">
      {children}
    </ol>
  );
}
