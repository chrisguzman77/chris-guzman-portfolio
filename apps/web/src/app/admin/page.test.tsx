// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { requireAccess } from "@/lib/cf-access";

import AdminPage, { metadata } from "./page";

vi.mock("@/lib/cf-access", () => ({ requireAccess: vi.fn() }));

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("AdminPage", () => {
  it("404s when access is denied", async () => {
    vi.mocked(requireAccess).mockRejectedValue(new Error("NEXT_HTTP_ERROR_FALLBACK;404"));
    await expect(AdminPage()).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
  });

  it("links to every admin tool", async () => {
    vi.mocked(requireAccess).mockResolvedValue(undefined);
    render(await AdminPage());
    expect(screen.getByRole("heading", { level: 1, name: "Admin" })).toBeTruthy();
    const links: Record<string, string> = {
      Subscribers: "/admin/subscribers",
      Content: "https://cms.christopherguzman.me",
      Monitoring: "https://grafana.christopherguzman.me",
      Analytics: "https://analytics.christopherguzman.me",
    };
    for (const [name, href] of Object.entries(links)) {
      const link = screen.getByRole("link", { name: new RegExp(`^${name}`) });
      expect(link.getAttribute("href")).toBe(href);
    }
    expect(screen.getAllByRole("link")).toHaveLength(4);
  });

  it("is never indexed", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
