"use client";

import { useTheme } from "next-themes";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { Turnstile } from "@/components/contact/turnstile";
import { track } from "@/lib/analytics";
import { NEWSLETTER_MESSAGES, isValidEmail, subscribe } from "@/lib/newsletter";

type Problem = Exclude<keyof typeof NEWSLETTER_MESSAGES, "checkInbox">;

const inputClass =
  "min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-base text-foreground md:text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-brand aria-[invalid=true]:border-destructive";
const buttonClass =
  "inline-flex shrink-0 items-center justify-center rounded-md bg-accent-brand px-3.5 py-2 text-[13px] font-semibold text-accent-brand-foreground transition-opacity hover:opacity-90 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-brand";

// Turnstile's script loads on the first focus of the email field, so pages showing this box
// pay no script cost until someone starts typing.
export function SubscribeForm({ apiUrl, siteKey }: { apiUrl: string; siteKey: string }) {
  const id = useId();
  const { resolvedTheme } = useTheme();
  const doneRef = useRef<HTMLParagraphElement>(null);
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [armed, setArmed] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [turnstileFailed, setTurnstileFailed] = useState(false);
  const [resetSignal, setResetSignal] = useState(0);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (done) doneRef.current?.focus();
  }, [done]);

  function onToken(next: string | null) {
    setToken(next);
    if (next) setTurnstileFailed(false);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setArmed(true);
    if (!isValidEmail(email)) {
      setProblem("invalidEmail");
      return;
    }
    if (!token) {
      setProblem(turnstileFailed ? "unavailable" : "pendingToken");
      return;
    }
    setProblem(null);
    setSending(true);
    const result = await subscribe(apiUrl, { email, turnstile_token: token, website });
    setSending(false);
    if (result === "ok") {
      track("newsletter-subscribe");
      setDone(true);
      return;
    }
    // Turnstile tokens are single-use: get a fresh one for the next attempt.
    setResetSignal((n) => n + 1);
    setProblem(
      result === "invalid"
        ? "invalidEmail"
        : result === "rate_limited"
          ? "rateLimited"
          : result === "turnstile"
            ? "turnstile"
            : "unavailable",
    );
  }

  const emailId = `${id}-email`;
  const problemId = `${id}-problem`;
  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="rounded-[10px] border border-border bg-card p-5"
    >
      <h2 id={`${id}-heading`} className="text-[15px] font-semibold">
        Subscribe
      </h2>
      {done ? (
        <p
          ref={doneRef}
          role="status"
          tabIndex={-1}
          className="mt-3 text-sm text-foreground outline-none"
        >
          {NEWSLETTER_MESSAGES.checkInbox}
        </p>
      ) : (
        <form noValidate onSubmit={onSubmit} aria-label="Subscribe" className="relative mt-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <label htmlFor={emailId} className="sr-only">
              Email
            </label>
            <input
              id={emailId}
              type="email"
              name="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onFocus={() => setArmed(true)}
              onChange={(event) => setEmail(event.target.value)}
              aria-invalid={problem === "invalidEmail" ? true : undefined}
              aria-describedby={problem ? problemId : undefined}
              className={inputClass}
            />
            <button type="submit" disabled={sending} className={buttonClass}>
              Subscribe
            </button>
          </div>
          <div aria-hidden="true" className="absolute -left-[9999px] size-px overflow-hidden">
            <label htmlFor={`${id}-hp`}>Leave this field empty</label>
            <input
              id={`${id}-hp`}
              name="newsletter_hp"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={website}
              onChange={(event) => setWebsite(event.target.value)}
            />
          </div>
          {armed ? (
            <Turnstile
              siteKey={siteKey}
              theme={resolvedTheme === "light" ? "light" : "dark"}
              resetSignal={resetSignal}
              onToken={onToken}
              onError={() => setTurnstileFailed(true)}
            />
          ) : null}
          {problem ? (
            <p id={problemId} role="alert" className="mt-2 text-sm text-destructive">
              {NEWSLETTER_MESSAGES[problem]}
            </p>
          ) : null}
        </form>
      )}
      <p className="mt-2 text-xs text-muted-foreground">No spam. Unsubscribe anytime.</p>
    </section>
  );
}
