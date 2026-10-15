"use client";

import { useEffect } from "react";

// Cursor effects need a mouse that can hover, and a visitor who is fine with motion.
export const POINTER_QUERY =
  "(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)";

// Writes the pointer position into CSS variables once per frame. globals.css draws the
// page spotlight (body::after) and the glow inside the hovered .card-glow from them.
export function PointerGlow() {
  useEffect(() => {
    if (!window.matchMedia(POINTER_QUERY).matches) return;
    const root = document.documentElement;
    let frame = 0;
    let last: PointerEvent | null = null;

    function paint() {
      frame = 0;
      if (!last) return;
      // Measure before writing anything so the reads don't force a style recalc mid-paint.
      const card =
        last.target instanceof Element ? last.target.closest<HTMLElement>(".card-glow") : null;
      const rect = card?.getBoundingClientRect();
      root.style.setProperty("--spot-x", `${last.clientX}px`);
      root.style.setProperty("--spot-y", `${last.clientY}px`);
      root.dataset.spotlight = "";
      if (card && rect) {
        card.style.setProperty("--card-x", `${last.clientX - rect.left}px`);
        card.style.setProperty("--card-y", `${last.clientY - rect.top}px`);
      }
    }
    function onMove(event: PointerEvent) {
      if (event.pointerType !== "mouse") return;
      last = event;
      if (!frame) frame = window.requestAnimationFrame(paint);
    }
    function onLeave() {
      if (frame) {
        window.cancelAnimationFrame(frame);
        frame = 0;
      }
      last = null;
      delete root.dataset.spotlight;
    }

    window.addEventListener("pointermove", onMove, { passive: true });
    root.addEventListener("pointerleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerleave", onLeave);
      if (frame) window.cancelAnimationFrame(frame);
      delete root.dataset.spotlight;
    };
  }, []);
  return null;
}
