// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getStatus, type SiteStatus } from "@/lib/status";

import { StatusCard, StatusCardSkeleton } from "./status-card";

vi.mock("next/server", () => ({ connection: vi.fn(async () => undefined) }));
vi.mock("@/lib/status", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/status")>()),
  getStatus: vi.fn(),
}));

const DATES = Array.from({ length: 30 }, (_, i) =>
  new Date(Date.UTC(2026, 8, 4 + i)).toISOString().slice(0, 10),
);

function status(over: Partial<SiteStatus> = {}): SiteStatus {
  return {
    status: "operational",
    uptime_30d: 0.9998,
    daily: DATES.map((date, i) => ({ date, uptime: i === 29 ? 0.9997 : 1 })),
    p95_ms: 84,
    requests_today: 1204,
    last_backup_at: "2026-10-03T09:00:00Z",
    ...over,
  };
}

function row(label: string): string | null | undefined {
  return screen.getByText(label).nextElementSibling?.textContent;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.mocked(getStatus).mockReset();
});

describe("StatusCard", () => {
  it("shows the operational header, every stat, and 30 labelled bars", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-03T12:00:00Z"));
    vi.mocked(getStatus).mockResolvedValue(status());
    const { container } = render(await StatusCard());

    expect(screen.getByRole("region", { name: "Site status" })).toBeTruthy();
    expect(screen.getByText("all systems operational · self-hosted on Proxmox")).toBeTruthy();
    expect(container.querySelector("p > .bg-live")).toBeTruthy();
    expect(row("uptime (30d)")).toBe("99.98%");
    expect(row("api response (p95)")).toBe("84 ms");
    expect(row("requests today")).toBe("1,204");
    expect(row("last backup")).toBe("3h ago · encrypted · R2");
    expect(row("stack")).toBe("Proxmox · Docker · Cloudflare Tunnel");
    expect(screen.getByText("30 days ago")).toBeTruthy();
    expect(screen.getByText("today")).toBeTruthy();

    const images = screen.getAllByRole("img");
    expect(images).toHaveLength(1);
    expect(images[0].getAttribute("aria-label")).toBe(
      "30-day uptime, 29 days at 100%, 1 day at 99.97%",
    );
    const bars = images[0].children;
    expect(bars).toHaveLength(30);
    for (const bar of bars) expect(bar.getAttribute("aria-hidden")).toBe("true");
    expect(bars[29].getAttribute("title")).toBe("Oct 3: 99.97%");
  });

  it("shows the degraded header with an amber dot but keeps real values", async () => {
    vi.mocked(getStatus).mockResolvedValue(status({ status: "degraded" }));
    const { container } = render(await StatusCard());

    expect(screen.getByText("degraded · self-hosted on Proxmox")).toBeTruthy();
    expect(container.querySelector("p > .bg-warn")).toBeTruthy();
    expect(container.querySelector("p > .bg-live")).toBeNull();
    expect(row("api response (p95)")).toBe("84 ms");
  });

  it("shows — for every null value and muted bars for null days", async () => {
    vi.mocked(getStatus).mockResolvedValue({
      status: "degraded",
      uptime_30d: null,
      daily: DATES.map((date) => ({ date, uptime: null })),
      p95_ms: null,
      requests_today: null,
      last_backup_at: null,
    });
    const { container } = render(await StatusCard());

    expect(screen.getByText("degraded · self-hosted on Proxmox")).toBeTruthy();
    for (const label of ["uptime (30d)", "api response (p95)", "requests today", "last backup"]) {
      expect(row(label)).toBe("—");
    }
    expect(row("stack")).toBe("Proxmox · Docker · Cloudflare Tunnel");
    const image = screen.getByRole("img", { name: "30-day uptime, 30 days with no data" });
    expect(image.children).toHaveLength(30);
    expect(image.children[29].getAttribute("title")).toBe("Oct 3: no data");
    for (const bar of image.children) expect(bar.className).toContain("bg-muted-foreground/30");
    expect(container.querySelector(".bg-live[title]")).toBeNull();
  });

  it("renders the degraded card with — and 30 muted bars when the API is unreachable", async () => {
    vi.mocked(getStatus).mockResolvedValue(null);
    const { container } = render(await StatusCard());

    expect(screen.getByText("degraded · self-hosted on Proxmox")).toBeTruthy();
    expect(container.querySelector("p > .bg-warn")).toBeTruthy();
    for (const label of ["uptime (30d)", "api response (p95)", "requests today", "last backup"]) {
      expect(row(label)).toBe("—");
    }
    const image = screen.getByRole("img", { name: "30-day uptime, 30 days with no data" });
    expect(image.children).toHaveLength(30);
    for (const bar of image.children) expect(bar.className).toContain("bg-muted-foreground/30");
  });

  it("colours a day green at 99.5% or more, amber below, muted when null", async () => {
    const daily = DATES.map((date) => ({ date, uptime: 1 as number | null }));
    daily[0].uptime = 0.995;
    daily[1].uptime = 0.9949;
    daily[2].uptime = null;
    vi.mocked(getStatus).mockResolvedValue(status({ daily }));
    render(await StatusCard());

    const bars = screen.getByRole("img").children;
    expect(bars[0].className).toContain("bg-live");
    expect(bars[1].className).toContain("bg-warn");
    expect(bars[1].className).not.toContain("bg-live");
    expect(bars[2].className).toContain("bg-muted-foreground/30");
  });

  it("exposes no per-bar image roles", async () => {
    vi.mocked(getStatus).mockResolvedValue(status());
    const { container } = render(await StatusCard());
    expect(container.querySelectorAll('[role="img"]')).toHaveLength(1);
  });

  it("is full width on phones and capped at 380px from md up", async () => {
    vi.mocked(getStatus).mockResolvedValue(status());
    render(await StatusCard());

    const card = screen.getByRole("region", { name: "Site status" });
    expect(card.className.split(/\s+/)).toEqual(
      expect.arrayContaining(["w-full", "md:max-w-[380px]", "bg-card", "border-border"]),
    );
  });
});

describe("StatusCardSkeleton", () => {
  it("says checking status and claims nothing", () => {
    const { container } = render(<StatusCardSkeleton />);

    expect(screen.getByText("checking status · self-hosted on Proxmox")).toBeTruthy();
    expect(container.querySelector(".bg-live")).toBeNull();
    expect(container.querySelector(".bg-warn")).toBeNull();
    expect(screen.queryAllByRole("img")).toHaveLength(0);
    expect(screen.getAllByText("loading").length).toBeGreaterThan(0);
    expect(screen.queryByText("—")).toBeNull();
    expect(screen.queryByText(/%/)).toBeNull();
    expect(screen.getByText("uptime (30d)")).toBeTruthy();
    expect(screen.getByText("30 days ago")).toBeTruthy();
  });
});
