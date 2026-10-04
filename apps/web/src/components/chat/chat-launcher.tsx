"use client";

import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { track } from "@/lib/analytics";
import { currentPlatform, isApplePlatform, isChatShortcut, shortcutLabel } from "@/lib/platform";

// The terminal's code downloads only when a visitor first opens it.
const ChatTerminal = lazy(() =>
  import("./chat-terminal").then((module) => ({ default: module.ChatTerminal })),
);

const subscribe = () => () => {};
const readLabel = () =>
  shortcutLabel(currentPlatform(), window.matchMedia("(pointer: coarse)").matches);
const serverLabel = () => null; // no label in server HTML, so hydration never mismatches

// How far the site footer reaches up into the viewport, so the pill can rest above it
// instead of covering the footer's links. 0 while the footer is off screen.
function useFooterOverlap(): number {
  const [overlap, setOverlap] = useState(0);
  useEffect(() => {
    let frame = 0;
    function measure() {
      frame = 0;
      const footer = document.querySelector("footer");
      const top = footer ? footer.getBoundingClientRect().top : window.innerHeight;
      setOverlap(Math.max(0, Math.round(window.innerHeight - top)));
    }
    function schedule() {
      if (!frame) frame = window.requestAnimationFrame(measure);
    }
    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);
  return overlap;
}

export function ChatLauncher({
  apiUrl,
  siteKey,
  suggestions,
}: {
  apiUrl: string;
  siteKey: string;
  suggestions: string[];
}) {
  const label = useSyncExternalStore(subscribe, readLabel, serverLabel);
  const footerOverlap = useFooterOverlap();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const pillRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);

  const show = useCallback(() => {
    returnFocus.current = document.activeElement as HTMLElement | null;
    setLoaded(true);
    setOpen(true);
    track("chat-open"); // pill and shortcut both open through here
  }, []);

  const hide = useCallback(() => {
    restoreFocus.current = true;
    setOpen(false);
  }, []);

  useEffect(() => {
    if (open || !restoreFocus.current) return;
    restoreFocus.current = false;
    const target = returnFocus.current;
    // The pill unmounts while the panel is open; fall back to the re-rendered one.
    // Safari does not focus clicked buttons, so the target can be <body>.
    const usable = target && target !== document.body && target.isConnected;
    (usable ? target : pillRef.current)?.focus();
  }, [open]);

  useEffect(() => {
    const apple = isApplePlatform(currentPlatform());
    function onKey(event: KeyboardEvent) {
      if (!isChatShortcut(event, apple)) return;
      event.preventDefault();
      if (open) hide();
      else show();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, show, hide]);

  useEffect(() => {
    if (!open) return;
    function onEscape(event: KeyboardEvent) {
      if (event.key === "Escape") hide();
    }
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [open, hide]);

  return (
    <>
      {open ? null : (
        <button
          ref={pillRef}
          type="button"
          onClick={show}
          aria-keyshortcuts={label === "⌘K" ? "Meta+K" : label ? "Control+K" : undefined}
          style={footerOverlap ? { transform: `translateY(-${footerOverlap}px)` } : undefined}
          className="chat-pill-glow fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-40 inline-flex items-center gap-2.5 rounded-full border border-border bg-card py-2.5 pr-5 pl-2.5 text-sm font-semibold text-foreground shadow-lg transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-brand"
        >
          {label ? (
            <kbd className="rounded-md border border-border bg-background px-2 py-1 font-mono text-xs font-normal text-accent-brand">
              {label}
            </kbd>
          ) : (
            <span className="pl-2.5" />
          )}
          Ask about Chris
        </button>
      )}
      {loaded ? (
        <Suspense fallback={null}>
          <ChatTerminal
            hidden={!open}
            onClose={hide}
            apiUrl={apiUrl}
            siteKey={siteKey}
            suggestions={suggestions}
          />
        </Suspense>
      ) : null}
    </>
  );
}
