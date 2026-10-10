"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";

import { submitLinkToken, type LinkAction, type LinkResult } from "@/lib/newsletter";

type State = "ready" | "working" | LinkResult;

const PROMPT: Record<LinkAction, string> = {
  confirm: "Click the button to confirm your subscription.",
  unsubscribe: "Click the button to stop getting new-post emails.",
};
const BUTTON: Record<LinkAction, string> = {
  confirm: "Confirm subscription",
  unsubscribe: "Unsubscribe",
};
const WORKING: Record<LinkAction, string> = {
  confirm: "Confirming…",
  unsubscribe: "Unsubscribing…",
};
const DONE: Record<LinkAction, string> = {
  confirm: "You're subscribed. You'll get an email when there's a new post.",
  unsubscribe: "You're unsubscribed.",
};
const UNAVAILABLE = "Something went wrong. Try again in a minute.";

const buttonClass =
  "mt-4 inline-flex items-center justify-center rounded-md bg-accent-brand px-3.5 py-2 text-[13px] font-semibold text-accent-brand-foreground transition-opacity hover:opacity-90 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-brand";

// Nothing happens until a person clicks. Mail security scanners (Microsoft Safe Links and
// similar) open every link in a real browser and run its scripts, so acting on page load
// would let them confirm or unsubscribe people. They do not click buttons.
export function NewsletterAction({
  action,
  apiUrl,
  token,
}: {
  action: LinkAction;
  apiUrl: string;
  token: string;
}) {
  const [state, setState] = useState<State>(token ? "ready" : "invalid");

  async function submit() {
    setState("working");
    setState(await submitLinkToken(apiUrl, action, token));
  }

  let message: ReactNode;
  if (state === "ready") message = PROMPT[action];
  else if (state === "working") message = WORKING[action];
  else if (state === "ok") message = DONE[action];
  else if (state === "unavailable") message = UNAVAILABLE;
  else if (action === "confirm")
    message = (
      <>
        This link has expired. Subscribe again from{" "}
        <Link href="/blog" className="underline underline-offset-4">
          the blog
        </Link>
        .
      </>
    );
  else message = "This unsubscribe link is not valid.";

  const canSubmit = state === "ready" || state === "working" || state === "unavailable";
  return (
    <div>
      <p role="status" className="mt-4 text-sm text-foreground">
        {message}
      </p>
      {canSubmit ? (
        <button
          type="button"
          onClick={submit}
          disabled={state === "working"}
          className={buttonClass}
        >
          {BUTTON[action]}
        </button>
      ) : null}
    </div>
  );
}
