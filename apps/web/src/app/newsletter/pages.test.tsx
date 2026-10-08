// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ConfirmPage, { metadata as confirmMetadata } from "./confirm/page";
import UnsubscribePage, { metadata as unsubscribeMetadata } from "./unsubscribe/page";

vi.mock("@/components/newsletter/newsletter-action", () => ({
  NewsletterAction: (props: { action: string; apiUrl: string; token: string }) => (
    <div data-testid="action">{JSON.stringify(props)}</div>
  ),
}));

afterEach(cleanup);

const NO_INDEX = { index: false, follow: false };
const API = "https://api.christopherguzman.me";

describe("newsletter pages", () => {
  it("are not indexed", () => {
    expect(confirmMetadata.robots).toEqual(NO_INDEX);
    expect(unsubscribeMetadata.robots).toEqual(NO_INDEX);
  });

  it("confirm page passes the token to the action", async () => {
    render(await ConfirmPage({ searchParams: Promise.resolve({ token: "t1" }) }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Confirm subscription");
    expect(screen.getByTestId("action").textContent).toBe(
      JSON.stringify({ action: "confirm", apiUrl: API, token: "t1" }),
    );
  });

  it("confirm page drops an array token", async () => {
    render(await ConfirmPage({ searchParams: Promise.resolve({ token: ["a", "b"] }) }));
    expect(screen.getByTestId("action").textContent).toBe(
      JSON.stringify({ action: "confirm", apiUrl: API, token: "" }),
    );
  });

  it("unsubscribe page passes the token to the action", async () => {
    render(await UnsubscribePage({ searchParams: Promise.resolve({ token: "u1" }) }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Unsubscribe");
    expect(screen.getByTestId("action").textContent).toBe(
      JSON.stringify({ action: "unsubscribe", apiUrl: API, token: "u1" }),
    );
  });

  it("unsubscribe page drops an array token", async () => {
    render(await UnsubscribePage({ searchParams: Promise.resolve({ token: ["a", "b"] }) }));
    expect(screen.getByTestId("action").textContent).toBe(
      JSON.stringify({ action: "unsubscribe", apiUrl: API, token: "" }),
    );
  });
});
