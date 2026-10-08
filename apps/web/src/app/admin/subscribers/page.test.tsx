// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { requireAccess } from "@/lib/cf-access";
import { listSubscribers } from "@/lib/subscribers";

import SubscribersPage, { metadata } from "./page";

vi.mock("@/lib/cf-access", () => ({ requireAccess: vi.fn() }));
vi.mock("@/lib/subscribers", () => ({ listSubscribers: vi.fn() }));
vi.mock("./actions", () => ({ removeSubscriberAction: vi.fn() }));

const list = {
  subscribers: [
    {
      id: "0b6f1c1e-0000-4000-8000-000000000001",
      email: "ada@example.com",
      status: "confirmed" as const,
      created_at: "2026-10-01T10:00:00Z",
      confirmed_at: "2026-10-02T10:00:00Z",
    },
    {
      id: "0b6f1c1e-0000-4000-8000-000000000002",
      email: "bo@example.com",
      status: "pending" as const,
      created_at: "2026-10-03T10:00:00Z",
      confirmed_at: null,
    },
  ],
  totals: { confirmed: 1, pending: 1 },
};

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("SubscribersPage", () => {
  it("404s before reading any data when access is denied", async () => {
    vi.mocked(requireAccess).mockRejectedValue(new Error("NEXT_HTTP_ERROR_FALLBACK;404"));
    await expect(SubscribersPage()).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(listSubscribers).not.toHaveBeenCalled();
  });

  it("renders totals, rows and a remove form per subscriber", async () => {
    vi.mocked(requireAccess).mockResolvedValue(undefined);
    vi.mocked(listSubscribers).mockResolvedValue(list);
    render(await SubscribersPage());
    expect(screen.getByText("1 confirmed · 1 pending")).toBeTruthy();
    expect(screen.getByText("ada@example.com")).toBeTruthy();
    expect(screen.getByText("bo@example.com")).toBeTruthy();
    expect(screen.getByText("–")).toBeTruthy();
    for (const s of list.subscribers) {
      const button = screen.getByRole("button", { name: `Remove ${s.email}` });
      const form = button.closest("form") as HTMLFormElement;
      expect(form).not.toBeNull();
      const hidden = within(form).getByDisplayValue(s.id) as HTMLInputElement;
      expect(hidden.type).toBe("hidden");
      expect(hidden.name).toBe("id");
    }
  });

  it("shows a message when the list cannot be loaded", async () => {
    vi.mocked(requireAccess).mockResolvedValue(undefined);
    vi.mocked(listSubscribers).mockResolvedValue(null);
    render(await SubscribersPage());
    expect(screen.getByText(/Couldn't load subscribers/)).toBeTruthy();
  });

  it("is noindex", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
