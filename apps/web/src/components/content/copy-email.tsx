"use client";

import { Check, Copy, Mail } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

// Same compact size as the Open buttons beside it on /contact.
const buttonClass =
  "inline-flex shrink-0 items-center gap-1.5 rounded-md border border-input px-2.5 py-1.5 text-xs text-foreground transition-colors hover:bg-background";

const subscribe = () => () => {};
const clipboardAvailable = () => typeof navigator.clipboard?.writeText === "function";
const assumeAvailable = () => true;

export function CopyEmail({ email }: { email: string }) {
  const canCopy = useSyncExternalStore(subscribe, clipboardAvailable, assumeAvailable);
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(resetTimer.current), []);

  if (!canCopy || status === "failed") {
    return (
      <a href={`mailto:${email}`} className={buttonClass}>
        <Mail className="size-3.5" aria-hidden />
        Send email
      </a>
    );
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(email);
      setStatus("copied");
      clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setStatus("idle"), 2000);
    } catch {
      setStatus("failed");
    }
  }

  const copied = status === "copied";
  return (
    <button type="button" onClick={copy} className={buttonClass}>
      {copied ? (
        <Check className="size-3.5 text-accent-brand" aria-hidden />
      ) : (
        <Copy className="size-3.5" aria-hidden />
      )}
      <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}
