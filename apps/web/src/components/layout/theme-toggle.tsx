"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import type { MouseEvent } from "react";
import { flushSync } from "react-dom";

import { Button } from "@/components/ui/button";

const REVEAL_MS = 650;

// Distance from (x, y) to the farthest viewport corner: the circle that covers the whole page.
export function revealRadius(x: number, y: number, width: number, height: number): number {
  return Math.hypot(Math.max(x, width - x), Math.max(y, height - y));
}

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  function toggle(event: MouseEvent<HTMLButtonElement>) {
    const next = resolvedTheme === "dark" ? "light" : "dark";
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!document.startViewTransition || reduced) {
      setTheme(next);
      return;
    }
    const button = event.currentTarget.getBoundingClientRect();
    const x = button.left + button.width / 2;
    const y = button.top + button.height / 2;
    // flushSync applies the new theme class inside the callback, before the browser
    // captures the "after" snapshot.
    const transition = document.startViewTransition(() => flushSync(() => setTheme(next)));
    transition.ready
      .then(() => {
        const radius = revealRadius(x, y, window.innerWidth, window.innerHeight);
        document.documentElement.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
          {
            duration: REVEAL_MS,
            easing: "ease-in-out",
            pseudoElement: "::view-transition-new(root)",
          },
        );
      })
      .catch(() => {}); // a skipped transition rejects `ready`; the theme has still changed
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle theme"
      className="focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-brand"
      onClick={toggle}
    >
      <Sun className="size-5 dark:hidden" />
      <Moon className="hidden size-5 dark:block" />
    </Button>
  );
}
