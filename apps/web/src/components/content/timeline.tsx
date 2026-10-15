"use client";

import { type ReactNode, useEffect, useRef } from "react";

// Entries light, and the line reaches, this far down the viewport.
const LIGHT_AT = 0.65;
// Distance from an entry's top to its dot's centre (matches .timeline > li::before in globals.css).
const DOT_CENTER = 24;

// How far the LIGHT_AT line has moved from the first dot's centre to the last dot's centre, which
// is the span the mint fill covers. Both are dot centres in viewport px; a single dot is just "done".
export function timelineProgress(firstDot: number, lastDot: number, viewport: number): number {
  if (lastDot <= firstDot) return 1;
  return Math.min(1, Math.max(0, (viewport * LIGHT_AT - firstDot) / (lastDot - firstDot)));
}

// /experience: a mint line grows down the list as the visitor scrolls and each entry's dot lights
// as it passes. Without JS or with reduced motion the list keeps its final state (full line, every
// dot lit), because the CSS only dims anything once data-timeline-ready is set. Transitions only
// start once data-timeline-animate is set, so the initial dim never animates.
export function Timeline({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const list = ref.current;
    if (!list) return;
    const el = list;

    // Ends the track at the last dot; also wanted when the full line is shown (reduced motion).
    function measureEnd() {
      const last = el.lastElementChild;
      if (!last) return;
      const rect = el.getBoundingClientRect();
      const lastTop = last.getBoundingClientRect().top;
      el.style.setProperty(
        "--timeline-end",
        `${rect.height - (lastTop - rect.top) - DOT_CENTER}px`,
      );
    }
    measureEnd();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    let animateFrame = 0;
    let furthest = 0; // never retract: lit dots are sticky, so the line must be too

    function update() {
      frame = 0;
      measureEnd();
      const items = Array.from(el.children) as HTMLElement[];
      const tops = items.map((item) => item.getBoundingClientRect().top);
      const doc = document.documentElement;
      const viewport = window.innerHeight;
      const atBottom = viewport + window.scrollY >= doc.scrollHeight - 2;
      const first = tops[0];
      const last = tops.at(-1);
      const progress =
        atBottom || first === undefined || last === undefined
          ? 1
          : timelineProgress(first + DOT_CENTER, last + DOT_CENTER, viewport);
      furthest = Math.max(furthest, progress);
      el.style.setProperty("--timeline-progress", String(Math.round(furthest * 100) / 100));
      items.forEach((item, index) => {
        if (atBottom || tops[index] + DOT_CENTER <= viewport * LIGHT_AT) item.dataset.lit = "";
      });
    }
    function schedule() {
      if (!frame) frame = window.requestAnimationFrame(update);
    }

    update(); // light what is already in view before dimming the rest: no flicker
    el.dataset.timelineReady = "";
    // Two frames: the dimmed state is painted before any transition is allowed to run.
    animateFrame = window.requestAnimationFrame(() => {
      animateFrame = window.requestAnimationFrame(() => {
        animateFrame = 0;
        el.dataset.timelineAnimate = "";
      });
    });
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    observer?.observe(el);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      observer?.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
      if (animateFrame) window.cancelAnimationFrame(animateFrame);
    };
  }, []);

  return (
    <ol ref={ref} className="timeline divide-y divide-dashed divide-border">
      {children}
    </ol>
  );
}
