// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { connection } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as LiveStatusModule from "./live-status";

vi.mock("next/server", () => ({ connection: vi.fn(async () => undefined) }));

const fetchMock = vi.fn();
let LiveStatus: typeof LiveStatusModule.LiveStatus;
let LiveStatusFallback: typeof LiveStatusModule.LiveStatusFallback;

beforeEach(async () => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("API_INTERNAL_URL", "http://api:8000");
  // Fresh module per test: the last health result is memoised at module level.
  vi.resetModules();
  ({ LiveStatus, LiveStatusFallback } = await import("./live-status"));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
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
      expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }),
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

  it("reports degraded when a 200 response has invalid JSON", async () => {
    fetchMock.mockResolvedValue(new Response("not json", { status: 200 }));
    render(await LiveStatus());
    expect(screen.getByText("degraded · self-hosted on Proxmox")).toBeTruthy();
  });

  it("reports degraded when a 200 response reports db down", async () => {
    fetchMock.mockResolvedValue(Response.json({ status: "ok", db: "down" }));
    render(await LiveStatus());
    expect(screen.getByText("degraded · self-hosted on Proxmox")).toBeTruthy();
  });

  it("reuses the last result for 60 seconds, then checks again", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
    fetchMock.mockResolvedValueOnce(Response.json({ status: "ok", db: "ok" }));
    render(await LiveStatus());
    cleanup();

    vi.setSystemTime(new Date("2026-10-01T12:00:59Z"));
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    render(await LiveStatus());
    expect(screen.getByText("all systems operational · self-hosted on Proxmox")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    cleanup();

    vi.setSystemTime(new Date("2026-10-01T12:01:01Z"));
    render(await LiveStatus());
    expect(screen.getByText("degraded · self-hosted on Proxmox")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("memoises a degraded result too", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    render(await LiveStatus());
    cleanup();

    vi.setSystemTime(new Date("2026-10-01T12:00:30Z"));
    fetchMock.mockResolvedValueOnce(Response.json({ status: "ok", db: "ok" }));
    render(await LiveStatus());
    expect(screen.getByText("degraded · self-hosted on Proxmox")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports degraded when the health check exceeds the 2 second timeout", async () => {
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    const started = Date.now();
    render(await LiveStatus());
    expect(screen.getByText("degraded · self-hosted on Proxmox")).toBeTruthy();
    expect(Date.now() - started).toBeGreaterThanOrEqual(1900);
  });

  it("has a neutral fallback that claims nothing about health", () => {
    const { container } = render(<LiveStatusFallback />);
    expect(screen.getByText("checking status · self-hosted on Proxmox")).toBeTruthy();
    expect(container.querySelector(".bg-live")).toBeNull();
    expect(container.querySelector(".bg-warn")).toBeNull();
  });
});
