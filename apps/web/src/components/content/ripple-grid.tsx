"use client";

import { type ReactNode, useEffect, useRef } from "react";

// The home heatmap's cells pop in as a wave the first time it scrolls into view (CSS in
// globals.css, "Heatmap ripple"). Skipped when it is already on screen at load (no hide-then-show
// flash), with reduced motion, and without JS: the cells are simply there. Hidden from screen
// readers: the caption under it carries the same total.
export function RippleGrid({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const grid = ref.current;
    if (!grid || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const rect = grid.getBoundingClientRect();
    if (rect.bottom > 0 && rect.top < window.innerHeight) return;
    grid.dataset.ripple = "armed";
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        grid.dataset.ripple = "play";
        observer.disconnect();
      },
      { threshold: 0.3 },
    );
    observer.observe(grid);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} aria-hidden="true" className="ripple-grid flex gap-[3px]">
      {children}
    </div>
  );
}
