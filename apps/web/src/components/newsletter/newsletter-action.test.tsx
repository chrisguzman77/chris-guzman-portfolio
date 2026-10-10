// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NewsletterAction } from "./newsletter-action";

const API = "https://api.example.com";

function reply(status: number, body: unknown = {}) {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

function click(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("NewsletterAction", () => {
  it("does nothing on load, so a mail scanner opening the link confirms no one", async () => {
    const fetchMock = reply(200, { status: "confirmed" });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <StrictMode>
        <NewsletterAction action="confirm" apiUrl={API} token="t1" />
      </StrictMode>,
    );
    expect(screen.getByText("Click the button to confirm your subscription.")).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("confirms once when the button is clicked", async () => {
    const fetchMock = reply(200, { status: "confirmed" });
    vi.stubGlobal("fetch", fetchMock);
    render(<NewsletterAction action="confirm" apiUrl={API} token="t1" />);
    click("Confirm subscription");
    expect(
      await screen.findByText("You're subscribed. You'll get an email when there's a new post."),
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`${API}/v1/newsletter/confirm`);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ token: "t1" });
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("explains an expired confirm link and links to the blog", async () => {
    vi.stubGlobal("fetch", reply(400, { error: { code: "invalid_token", message: "x" } }));
    render(<NewsletterAction action="confirm" apiUrl={API} token="old" />);
    click("Confirm subscription");
    const text = await screen.findByText(/This link has expired\. Subscribe again from/);
    expect(text.textContent).toBe("This link has expired. Subscribe again from the blog.");
    expect(screen.getByRole("link", { name: "the blog" }).getAttribute("href")).toBe("/blog");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("treats a missing token as expired and offers no button", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<NewsletterAction action="confirm" apiUrl={API} token="" />);
    expect(screen.getByText(/This link has expired/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("unsubscribes only when the button is clicked", async () => {
    const fetchMock = reply(200, { status: "unsubscribed" });
    vi.stubGlobal("fetch", fetchMock);
    render(<NewsletterAction action="unsubscribe" apiUrl={API} token="u.1" />);
    expect(screen.getByText("Click the button to stop getting new-post emails.")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    click("Unsubscribe");
    expect(await screen.findByText("You're unsubscribed.")).toBeTruthy();
    expect(fetchMock.mock.calls[0][0]).toBe(`${API}/v1/newsletter/unsubscribe`);
  });

  it.each([
    ["confirm", "Confirm subscription"],
    ["unsubscribe", "Unsubscribe"],
  ] as const)("%s: API down keeps the button for a retry", async (action, button) => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    render(<NewsletterAction action={action} apiUrl={API} token="t" />);
    click(button);
    expect(await screen.findByText("Something went wrong. Try again in a minute.")).toBeTruthy();
    expect(screen.getByRole("button", { name: button })).toBeTruthy();
  });

  it("explains an invalid unsubscribe link", async () => {
    vi.stubGlobal("fetch", reply(400, { error: { code: "invalid_token", message: "x" } }));
    render(<NewsletterAction action="unsubscribe" apiUrl={API} token="bad" />);
    click("Unsubscribe");
    expect(await screen.findByText("This unsubscribe link is not valid.")).toBeTruthy();
  });
});
