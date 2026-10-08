"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { submitLinkToken, type LinkAction, type LinkResult } from "@/lib/newsletter";

type State = "working" | LinkResult;

const WORKING: Record<LinkAction, string> = {
  confirm: "Confirming…",
  unsubscribe: "Unsubscribing…",
};
const DONE: Record<LinkAction, string> = {
  confirm: "You're subscribed. You'll get an email when there's a new post.",
  unsubscribe: "You're unsubscribed.",
};
const UNAVAILABLE = "Something went wrong. Open the link again in a minute.";

// The token is POSTed from the browser after load, so mail scanners that prefetch the
// link (a GET) never confirm or unsubscribe anyone.
export function NewsletterAction({
  action,
  apiUrl,
  token,
}: {
  action: LinkAction;
  apiUrl: string;
  token: string;
}) {
  const [state, setState] = useState<State>(token ? "working" : "invalid");
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true; // StrictMode runs effects twice in development
    void submitLinkToken(apiUrl, action, token).then(setState);
  }, [action, apiUrl, token]);

  let message: ReactNode;
  if (state === "working") message = WORKING[action];
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

  return (
    <p role="status" className="mt-4 text-sm text-foreground">
      {message}
    </p>
  );
}
