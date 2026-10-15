"use client";

import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef } from "react";

import { siteConfig } from "@/lib/site";

import { NavLink } from "./nav-link";

// Desktop nav. One mint bar sits under the current section's link and slides to the next one
// on navigation; it is drawn by measuring the link, so it is placed straight from the DOM.
export function MainNav() {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);
  const barRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const nav = navRef.current;
    const bar = barRef.current;
    if (!nav || !bar) return;
    function place() {
      const active = nav!.querySelector<HTMLElement>('a[aria-current="page"]');
      if (!active) {
        bar!.style.opacity = "0";
        return;
      }
      bar!.style.width = `${active.offsetWidth}px`;
      bar!.style.transform = `translateX(${active.offsetLeft}px)`;
      bar!.style.opacity = "1";
    }
    place();
    const frame = window.requestAnimationFrame(() => {
      bar.dataset.ready = "";
    });
    // Web fonts swapping in change link widths.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    observer?.observe(nav);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [pathname]);

  return (
    <nav ref={navRef} aria-label="Main" className="relative hidden items-center gap-4 md:flex">
      {siteConfig.nav.map((item) => (
        <NavLink key={item.href} href={item.href} underline={false}>
          {item.label}
        </NavLink>
      ))}
      <span
        ref={barRef}
        aria-hidden="true"
        data-nav-indicator=""
        className="nav-indicator pointer-events-none absolute -bottom-1.5 left-0 h-0.5 rounded-full bg-accent-brand opacity-0"
      />
    </nav>
  );
}
