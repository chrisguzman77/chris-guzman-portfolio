// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SubscribeForm } from "./subscribe-form";

vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "dark" }) }));

// The real widget loads Cloudflare's script; this one issues a token on mount unless told not to.
let issueToken = true;
vi.mock("@/components/contact/turnstile", () => ({
  Turnstile: ({ onToken }: { onToken: (t: string | null) => void }) => {
    useEffect(() => {
      if (issueToken) onToken("tok");
    }, [onToken]);
    return <div data-testid="turnstile" />;
  },
}));

const API = "https://api.example.com";

function renderForm() {
  render(<SubscribeForm apiUrl={API} siteKey="site-key" />);
  return {
    email: screen.getByRole("textbox", { name: "Email" }),
    button: screen.getByRole("button", { name: "Subscribe" }),
  };
}

beforeEach(() => {
  issueToken = true;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete window.umami;
});

describe("SubscribeForm", () => {
  it("shows the heading and note, and loads Turnstile only after the email field is focused", () => {
    const { email } = renderForm();
    expect(screen.getByRole("heading", { name: "Subscribe" })).toBeTruthy();
    expect(screen.getByText("No spam. Unsubscribe anytime.")).toBeTruthy();
    expect(screen.queryByTestId("turnstile")).toBeNull();
    act(() => email.focus());
    expect(screen.getByTestId("turnstile")).toBeTruthy();
  });

  it("rejects a bad address without calling the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { email, button } = renderForm();
    act(() => email.focus());
    fireEvent.change(email, { target: { value: "nope" } });
    fireEvent.click(button);
    expect(await screen.findByText("Enter a valid email address.")).toBeTruthy();
    expect(email.getAttribute("aria-invalid")).toBe("true");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("subscribes, tracks the event without the address, and confirms", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const trackMock = vi.fn();
    window.umami = { track: trackMock };
    const { email, button } = renderForm();
    act(() => email.focus());
    fireEvent.change(email, { target: { value: "ada@example.com" } });
    fireEvent.click(button);
    expect(await screen.findByText("Check your inbox to confirm.")).toBeTruthy();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      email: "ada@example.com",
      turnstile_token: "tok",
      website: "",
    });
    expect(trackMock).toHaveBeenCalledWith("newsletter-subscribe");
  });

  it.each([
    [429, {}, "Too many tries. Try again later."],
    [400, { error: { code: "turnstile_failed", message: "x" } }, "Spam check failed. Try again."],
    [503, {}, "Couldn't subscribe right now. Try again later."],
  ])("shows the %s message", async (status, body, text) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })),
    );
    const { email, button } = renderForm();
    act(() => email.focus());
    fireEvent.change(email, { target: { value: "ada@example.com" } });
    fireEvent.click(button);
    expect(await screen.findByText(text)).toBeTruthy();
  });

  it("asks the visitor to wait while the spam check has no token", async () => {
    issueToken = false;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { email, button } = renderForm();
    act(() => email.focus());
    fireEvent.change(email, { target: { value: "ada@example.com" } });
    fireEvent.click(button);
    await waitFor(() =>
      expect(screen.getByText("Spam check is still running. Try again in a moment.")).toBeTruthy(),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
