"use client";

import { useEffect } from "react";

// Cursor effects need a mouse that can hover, and a visitor who is fine with motion.
export const POINTER_QUERY =
  "(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)";

// Writes the pointer position, once per frame, into CSS variables on the element it is over:
// --hero-x/--hero-y on the home hero (.hero-glow, its spotlight) and --card-x/--card-y on a
// .card-glow (its inner glow). Both are relative to that element. globals.css draws the effects.
export function PointerGlow() {
  useEffect(() => {
    if (!window.matchMedia(POINTER_QUERY).matches) return;
    let frame = 0;
    let last: PointerEvent | null = null;

    function paint() {
      frame = 0;
      if (!last || !(last.target instanceof Element)) return;
      const { clientX, clientY } = last;
      // Measure everything before writing, so the reads don't force a style recalc mid-paint.
      const targets = [
        [last.target.closest<HTMLElement>(".hero-glow"), "--hero"],
        [last.target.closest<HTMLElement>(".card-glow"), "--card"],
      ] as const;
      const placed = targets.flatMap(([element, prefix]) =>
        element ? [{ element, prefix, rect: element.getBoundingClientRect() }] : [],
      );
      for (const { element, prefix, rect } of placed) {
        element.style.setProperty(`${prefix}-x`, `${clientX - rect.left}px`);
        element.style.setProperty(`${prefix}-y`, `${clientY - rect.top}px`);
      }
    }
    function onMove(event: PointerEvent) {
      if (event.pointerType !== "mouse") return;
      last = event;
      if (!frame) frame = window.requestAnimationFrame(paint);
    }

    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);
  return null;
}
