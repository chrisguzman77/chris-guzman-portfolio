"use client";

import { useEffect, useState } from "react";

const CHARS_PER_TICK = 3;
const TICK_MS = 12;

// Reveals an answer like terminal output. The full text is announced separately, so screen
// readers never hear it in fragments.
export function TypedText({ text, animate }: { text: string; animate: boolean }) {
  const [shown, setShown] = useState(animate ? 0 : text.length);

  useEffect(() => {
    if (!animate) return;
    const timer = setInterval(() => {
      setShown((n) => {
        const next = Math.min(text.length, n + CHARS_PER_TICK);
        if (next >= text.length) clearInterval(timer);
        return next;
      });
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [animate, text.length]);

  return (
    <p data-typed className="whitespace-pre-wrap text-foreground">
      {text.slice(0, shown)}
    </p>
  );
}
