"use client";

import { useEffect, useRef } from "react";

type TurnstileOptions = {
  sitekey: string;
  theme: "light" | "dark";
  appearance: "interaction-only";
  callback: (token: string) => void;
  "expired-callback": () => void;
  "error-callback": () => void;
};

export type TurnstileApi = {
  render: (container: HTMLElement, options: TurnstileOptions) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export const TURNSTILE_SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const SCRIPT_ID = "cf-turnstile-script";

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  return new Promise((resolve, reject) => {
    let script = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement("script");
      script.id = SCRIPT_ID;
      script.src = TURNSTILE_SCRIPT_SRC;
      script.async = true;
      document.head.appendChild(script);
    }
    script.addEventListener(
      "load",
      () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("no turnstile"))),
      { once: true },
    );
    script.addEventListener(
      "error",
      () => {
        // Drop the failed element so a later mount (e.g. theme change) loads it afresh.
        script?.remove();
        reject(new Error("turnstile failed to load"));
      },
      { once: true },
    );
  });
}

// Loaded only on /contact. "interaction-only" keeps the widget invisible unless Cloudflare
// needs the visitor to click.
export function Turnstile({
  siteKey,
  theme,
  resetSignal,
  onToken,
  onError,
}: {
  siteKey: string;
  theme: "light" | "dark";
  resetSignal: number;
  onToken: (token: string | null) => void;
  // The script or widget failed; the form offers the email address instead.
  onError: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onTokenRef.current = onToken;
    onErrorRef.current = onError;
  });

  useEffect(() => {
    let cancelled = false;
    loadTurnstile()
      .then((api) => {
        if (cancelled || !container.current) return;
        widgetId.current = api.render(container.current, {
          sitekey: siteKey,
          theme,
          appearance: "interaction-only",
          callback: (token) => onTokenRef.current(token),
          "expired-callback": () => onTokenRef.current(null),
          "error-callback": () => {
            onTokenRef.current(null);
            onErrorRef.current();
          },
        });
      })
      .catch(() => {
        if (cancelled) return;
        onTokenRef.current(null);
        onErrorRef.current();
      });
    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = null;
      // The removed widget's token goes with it; the new widget issues a fresh one.
      onTokenRef.current(null);
    };
  }, [siteKey, theme]);

  useEffect(() => {
    if (resetSignal === 0) return;
    if (widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current);
    onTokenRef.current(null);
  }, [resetSignal]);

  return <div ref={container} />;
}
