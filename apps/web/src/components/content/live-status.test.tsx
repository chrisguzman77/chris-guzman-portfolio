// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { connection } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LiveStatus } from "./live-status";

vi.mock("next/server", () => ({ connection: vi.fn(async () => undefined) }));

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("API_INTERNAL_URL", "http://api:8000");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fetchMock.mockReset();
  vi.mocked(connection).mockClear();
});

describe("LiveStatus", () => {
  it("reports operational with a green dot when the API and database are healthy", async () => {
    fetchMock.mockResolvedValue(Response.json({ status: "ok", db: "ok" }));
    const { container } = render(await LiveStatus());
    expect(screen.getByText("all systems operational · self-hosted on Proxmox")).toBeTruthy();
    expect(container.querySelector(".bg-live")).toBeTruthy();
    expect(connection).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://api:8000/health",
      expect.objectContaining({ next: { revalidate: 60 }, signal: expect.any(AbortSignal) }),
    );
  });

  it("reports degraded with an amber dot when the database is not ok", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ status: "ok", db: "unavailable" }, { status: 503 }),
    );
    const { container } = render(await LiveStatus());
    expect(screen.getByText("degraded · self-hosted on Proxmox")).toBeTruthy();
    expect(container.querySelector(".bg-warn")).toBeTruthy();
    expect(container.querySelector(".bg-live")).toBeNull();
  });

  it("reports degraded when the request fails or times out", async () => {
    fetchMock.mockRejectedValue(new DOMException("timed out", "TimeoutError"));
    render(await LiveStatus());
    expect(screen.getByText("degraded · self-hosted on Proxmox")).toBeTruthy();
  });

  it("reports degraded without calling fetch when API_INTERNAL_URL is unset", async () => {
    vi.stubEnv("API_INTERNAL_URL", "");
    render(await LiveStatus());
    expect(screen.getByText("degraded · self-hosted on Proxmox")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
