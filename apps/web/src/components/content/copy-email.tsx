"use client";

import { Check, Copy, Mail } from "lucide-react";
import { useState, useSyncExternalStore } from "react";

const buttonClass =
  "inline-flex items-center gap-2 rounded-md border border-input px-3.5 py-2 text-sm text-foreground transition-colors hover:bg-background";

const subscribe = () => () => {};
const clipboardAvailable = () => typeof navigator.clipboard?.writeText === "function";
const assumeAvailable = () => true;

export function CopyEmail({ email }: { email: string }) {
  const canCopy = useSyncExternalStore(subscribe, clipboardAvailable, assumeAvailable);
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

  if (!canCopy || status === "failed") {
    return (
      <a href={`mailto:${email}`} className={buttonClass}>
        <Mail className="size-4" aria-hidden />
        Send email
      </a>
    );
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(email);
      setStatus("copied");
      setTimeout(() => setStatus("idle"), 2000);
    } catch {
      setStatus("failed");
    }
  }

  const copied = status === "copied";
  return (
    <button type="button" onClick={copy} className={buttonClass}>
      {copied ? (
        <Check className="size-4 text-accent-brand" aria-hidden />
      ) : (
        <Copy className="size-4" aria-hidden />
      )}
      <span aria-live="polite">{copied ? "Copied" : "Copy address"}</span>
    </button>
  );
}
