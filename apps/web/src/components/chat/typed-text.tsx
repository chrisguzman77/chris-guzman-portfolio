"use client";

import { useEffect, useState } from "react";

const CHARS_PER_TICK = 3;
const TICK_MS = 12;

// Reveals an answer like terminal output. The full text is announced separately, so screen
// readers never hear it in fragments.
export function TypedText({ text, animate }: { text: string; animate: boolean }) {
  const [shown, setShown] = useState(animate ? 0 : text.length);

  const done = shown >= text.length;

  // The timer stops through this cleanup when `done` flips, never from inside the state updater.
  useEffect(() => {
    if (!animate || done) return;
    const timer = setInterval(() => {
      setShown((n) => Math.min(text.length, n + CHARS_PER_TICK));
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [animate, done, text.length]);

  return (
    <p data-typed className="whitespace-pre-wrap text-foreground">
      {text.slice(0, shown)}
    </p>
  );
}
