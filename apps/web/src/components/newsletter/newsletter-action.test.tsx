// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NewsletterAction } from "./newsletter-action";

const API = "https://api.example.com";

function reply(status: number, body: unknown = {}) {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("NewsletterAction", () => {
  it("confirms once on load, even under StrictMode", async () => {
    const fetchMock = reply(200, { status: "confirmed" });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <StrictMode>
        <NewsletterAction action="confirm" apiUrl={API} token="t1" />
      </StrictMode>,
    );
    expect(screen.getByText("Confirming…")).toBeTruthy();
    expect(
      await screen.findByText("You're subscribed. You'll get an email when there's a new post."),
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`${API}/v1/newsletter/confirm`);
  });

  it("explains an expired confirm link and links to the blog", async () => {
    vi.stubGlobal("fetch", reply(400, { error: { code: "invalid_token", message: "x" } }));
    render(<NewsletterAction action="confirm" apiUrl={API} token="old" />);
    const text = await screen.findByText(/This link has expired\. Subscribe again from/);
    expect(text.textContent).toBe("This link has expired. Subscribe again from the blog.");
    expect(screen.getByRole("link", { name: "the blog" }).getAttribute("href")).toBe("/blog");
  });

  it("treats a missing token as expired without calling the API", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<NewsletterAction action="confirm" apiUrl={API} token="" />);
    expect(screen.getByText(/This link has expired/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("unsubscribes on load", async () => {
    vi.stubGlobal("fetch", reply(200, { status: "unsubscribed" }));
    render(<NewsletterAction action="unsubscribe" apiUrl={API} token="u.1" />);
    expect(await screen.findByText("You're unsubscribed.")).toBeTruthy();
  });

  it.each(["confirm", "unsubscribe"] as const)("%s: API down asks to retry", async (action) => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    render(<NewsletterAction action={action} apiUrl={API} token="t" />);
    expect(
      await screen.findByText("Something went wrong. Open the link again in a minute."),
    ).toBeTruthy();
  });

  it("explains an invalid unsubscribe link", async () => {
    vi.stubGlobal("fetch", reply(400, { error: { code: "invalid_token", message: "x" } }));
    render(<NewsletterAction action="unsubscribe" apiUrl={API} token="bad" />);
    expect(await screen.findByText("This unsubscribe link is not valid.")).toBeTruthy();
  });
});
