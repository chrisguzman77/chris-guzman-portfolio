"use client";

import { useTheme } from "next-themes";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import {
  CONTACT_FIELDS,
  CONTACT_LIMITS,
  CONTACT_MESSAGES,
  submitContact,
  validateContact,
  type ContactErrors,
  type ContactField,
  type ContactValues,
} from "@/lib/contact";

import { Turnstile } from "./turnstile";

type Banner = "rateLimited" | "turnstile" | "pendingToken" | "unavailable";

const inputClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-brand aria-[invalid=true]:border-destructive";
const submitClass =
  "inline-flex items-center gap-2 rounded-md bg-accent-brand px-3.5 py-2 text-[13px] font-semibold text-accent-brand-foreground transition-opacity hover:opacity-90 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-brand";

function Field({
  field,
  label,
  error,
  children,
}: {
  field: ContactField;
  label: string;
  error: string | undefined;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={`contact-${field}`} className="mb-1.5 block text-xs text-muted-foreground">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`contact-${field}-error`} className="mt-1.5 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function ContactForm({
  apiUrl,
  siteKey,
  fallbackEmail,
}: {
  apiUrl: string;
  siteKey: string;
  fallbackEmail: string;
}) {
  const { resolvedTheme } = useTheme();
  const formRef = useRef<HTMLFormElement>(null);
  const sentRef = useRef<HTMLParagraphElement>(null);
  const [values, setValues] = useState<ContactValues>({ name: "", email: "", message: "" });
  const [website, setWebsite] = useState("");
  const [errors, setErrors] = useState<ContactErrors>({});
  const [banner, setBanner] = useState<Banner | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [turnstileFailed, setTurnstileFailed] = useState(false);
  const [resetSignal, setResetSignal] = useState(0);

  // The submit button unmounts on success; move focus so screen readers announce the result.
  useEffect(() => {
    if (sent) sentRef.current?.focus();
  }, [sent]);

  function onToken(next: string | null) {
    setToken(next);
    if (next) setTurnstileFailed(false);
  }

  function focusFirst(found: ContactErrors): boolean {
    const first = CONTACT_FIELDS.find((field) => found[field]);
    if (!first) return false;
    (formRef.current?.elements.namedItem(first) as HTMLElement | null)?.focus();
    return true;
  }

  function fieldProps(field: ContactField) {
    return {
      id: `contact-${field}`,
      name: field,
      value: values[field],
      onChange: (event: { target: { value: string } }) =>
        setValues((current) => ({ ...current, [field]: event.target.value })),
      "aria-invalid": errors[field] ? true : undefined,
      "aria-describedby": errors[field] ? `contact-${field}-error` : undefined,
      className: inputClass,
    };
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = validateContact(values);
    setErrors(found);
    setBanner(null);
    if (focusFirst(found)) return;
    if (!token) {
      // A failed spam check would never produce a token: offer the email address instead.
      setBanner(turnstileFailed ? "unavailable" : "pendingToken");
      return;
    }
    setSending(true);
    const result = await submitContact(apiUrl, { ...values, turnstile_token: token, website });
    setSending(false);
    if (result.kind === "sent") {
      setSent(true);
      return;
    }
    // Turnstile tokens are single-use: get a fresh one for the next attempt.
    setResetSignal((n) => n + 1);
    if (result.kind === "invalid" && Object.keys(result.fields).length > 0) {
      setErrors(result.fields);
      focusFirst(result.fields);
      return;
    }
    setBanner(
      result.kind === "rate_limited"
        ? "rateLimited"
        : result.kind === "turnstile"
          ? "turnstile"
          : "unavailable",
    );
  }

  if (sent) {
    return (
      <p ref={sentRef} role="status" tabIndex={-1} className="text-sm text-foreground outline-none">
        {CONTACT_MESSAGES.sent}
      </p>
    );
  }

  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={onSubmit}
      aria-label="Contact form"
      className="relative space-y-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field field="name" label="Name" error={errors.name}>
          <input
            type="text"
            autoComplete="name"
            maxLength={CONTACT_LIMITS.name}
            {...fieldProps("name")}
          />
        </Field>
        <Field field="email" label="Email" error={errors.email}>
          <input
            type="email"
            autoComplete="email"
            maxLength={CONTACT_LIMITS.email}
            {...fieldProps("email")}
          />
        </Field>
      </div>
      <Field field="message" label="Message" error={errors.message}>
        <textarea rows={6} maxLength={CONTACT_LIMITS.messageMax} {...fieldProps("message")} />
      </Field>
      <div aria-hidden="true" className="absolute -left-[9999px] size-px overflow-hidden">
        {/* Named so autofill leaves it alone; still sent to the API as `website`. */}
        <label htmlFor="contact-hp">Leave this field empty</label>
        <input
          id="contact-hp"
          name="contact_hp"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(event) => setWebsite(event.target.value)}
        />
      </div>
      <Turnstile
        siteKey={siteKey}
        theme={resolvedTheme === "light" ? "light" : "dark"}
        resetSignal={resetSignal}
        onToken={onToken}
        onError={() => setTurnstileFailed(true)}
      />
      {banner ? (
        <p role="alert" className="text-sm text-destructive">
          {banner === "unavailable" ? (
            <>
              Couldn&apos;t send. Email me at{" "}
              <a href={`mailto:${fallbackEmail}`} className="underline underline-offset-4">
                {fallbackEmail}
              </a>{" "}
              instead.
            </>
          ) : (
            CONTACT_MESSAGES[banner]
          )}
        </p>
      ) : null}
      <button type="submit" disabled={sending} className={submitClass}>
        {sending ? "Sending…" : "Send message"}
      </button>
    </form>
  );
}
