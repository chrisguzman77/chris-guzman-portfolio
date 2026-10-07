// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getResume } from "@/lib/directus/queries";
import type { Resume } from "@/lib/directus/schemas";

import ResumePage from "./page";

vi.mock("@/lib/directus/queries", () => ({ getResume: vi.fn() }));

const full: Resume = { file: "abc-123", version_label: "fall-2026", updated_at: "2026-10-01" };

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
  vi.mocked(getResume).mockReset();
});

describe("/resume", () => {
  it("shows the prompt and title", async () => {
    vi.mocked(getResume).mockResolvedValue(full);
    render(await ResumePage());

    expect(screen.getByText("$ open resume.pdf")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Resume" })).toBeTruthy();
  });

  it("renders the bar, the download button, and the desktop-only PDF frame", async () => {
    vi.mocked(getResume).mockResolvedValue(full);
    const { container } = render(await ResumePage());

    expect(screen.getByText("Christopher Guzman, Resume")).toBeTruthy();
    expect(screen.getByText("version fall-2026 · updated Oct 1, 2026")).toBeTruthy();

    const download = screen.getByRole("link", { name: /download pdf/i });
    expect(download.getAttribute("href")).toBe("/cms-assets/abc-123");
    expect(download.hasAttribute("download")).toBe(true);

    // The embed is server-rendered at every width (phones included).
    expect(container.querySelector("object")?.getAttribute("data")).toBe(
      "/cms-assets/abc-123#toolbar=0&view=Fit",
    );
  });

  it("omits missing parts of the version line", async () => {
    vi.mocked(getResume).mockResolvedValue({ ...full, version_label: null });
    render(await ResumePage());

    expect(screen.getByText("updated Oct 1, 2026")).toBeTruthy();
    expect(screen.queryByText(/version/)).toBeNull();
  });

  it("omits the version line entirely when neither part is set", async () => {
    vi.mocked(getResume).mockResolvedValue({ ...full, version_label: null, updated_at: null });
    render(await ResumePage());

    expect(screen.queryByText(/updated/)).toBeNull();
    expect(screen.getByRole("link", { name: /download pdf/i })).toBeTruthy();
  });

  it.each([null, { file: null, version_label: null, updated_at: null }])(
    "shows the empty state when there is no PDF (%o)",
    async (resume) => {
      vi.mocked(getResume).mockResolvedValue(resume);
      const { container } = render(await ResumePage());

      expect(screen.getByText(/Resume coming soon\./)).toBeTruthy();
      expect(screen.getByRole("link", { name: /experience/i }).getAttribute("href")).toBe(
        "/experience",
      );
      expect(screen.queryByRole("link", { name: /download pdf/i })).toBeNull();
      expect(container.querySelector("object")).toBeNull();
    },
  );

  it("tracks both PDF links as resume downloads from /resume and keeps the download attribute", async () => {
    vi.mocked(getResume).mockResolvedValue(full);
    const umamiTrack = vi.fn();
    window.umami = { track: umamiTrack };
    window.history.pushState({}, "", "/resume");
    const { container } = render(await ResumePage());

    const download = screen.getByRole("link", { name: /download pdf/i });
    expect(download.getAttribute("download")).toBe("christopher-guzman-resume.pdf");
    const fallback = container.querySelector("object a")!;
    expect(fallback.getAttribute("href")).toBe("/cms-assets/abc-123");

    const block = (event: Event) => event.preventDefault();
    document.addEventListener("click", block);
    fireEvent.click(download);
    fireEvent.click(fallback);
    document.removeEventListener("click", block);
    expect(umamiTrack.mock.calls).toEqual([
      ["resume-download", { from: "/resume" }],
      ["resume-download", { from: "/resume" }],
    ]);

    delete window.umami;
    window.history.pushState({}, "", "/");
  });
});
