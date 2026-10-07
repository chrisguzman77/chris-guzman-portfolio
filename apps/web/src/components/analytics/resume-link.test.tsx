// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ResumeLink } from "./resume-link";

afterEach(() => {
  cleanup();
  delete window.umami;
});

describe("ResumeLink", () => {
  it("sends resume-download exactly once per click, without Umami's declarative attribute", () => {
    const umamiTrack = vi.fn();
    window.umami = { track: umamiTrack };
    render(
      <ResumeLink href="/cms-assets/abc" download="resume.pdf">
        Download PDF
      </ResumeLink>,
    );

    const link = screen.getByRole("link", { name: "Download PDF" });
    expect(link.hasAttribute("data-umami-event")).toBe(false);
    const block = (event: Event) => event.preventDefault(); // jsdom cannot navigate
    document.addEventListener("click", block);
    fireEvent.click(link);
    document.removeEventListener("click", block);
    expect(umamiTrack).toHaveBeenCalledTimes(1);
    expect(umamiTrack).toHaveBeenCalledWith("resume-download", { from: "/" });
  });
});
