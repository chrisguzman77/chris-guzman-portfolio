export type OutboundTarget = "github" | "linkedin" | "repo" | "live" | "other";

// The only events the site sends. Events mapped to undefined take no data, so free text
// (a chat question) can never be attached by mistake.
type EventData = {
  "resume-download": { from: string };
  "chat-open": undefined;
  "chat-question": undefined;
  "contact-sent": undefined;
  "newsletter-subscribe": undefined;
  "outbound-click": { to: OutboundTarget };
};

export type AnalyticsEvent = keyof EventData;

declare global {
  interface Window {
    umami?: { track: (name: string, data?: Record<string, string>) => void };
  }
}

/** Sends a custom Umami event. Does nothing when the tracker is not loaded (no UMAMI_WEBSITE_ID, blocked). */
export function track<E extends AnalyticsEvent>(
  name: E,
  ...data: EventData[E] extends undefined ? [] : [EventData[E]]
): void {
  if (!window.umami) return;
  const [payload] = data as [Record<string, string>?];
  if (payload) window.umami.track(name, payload);
  else window.umami.track(name);
}

/** Umami's declarative click attributes for an external (new-tab) link. Safe in server components. */
export function outboundProps(to: OutboundTarget) {
  return { "data-umami-event": "outbound-click", "data-umami-event-to": to } as const;
}

/** For generic external links: github / linkedin by hostname, everything else "other". */
export function outboundTargetFor(href: string): OutboundTarget {
  let host: string;
  try {
    host = new URL(href).hostname;
  } catch {
    return "other";
  }
  const on = (domain: string) => host === domain || host.endsWith(`.${domain}`);
  if (on("github.com")) return "github";
  if (on("linkedin.com")) return "linkedin";
  return "other";
}
