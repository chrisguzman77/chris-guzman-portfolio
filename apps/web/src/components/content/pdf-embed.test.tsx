// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PdfEmbed } from "./pdf-embed";

function stubMatchMedia(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PdfEmbed", () => {
  it("renders no <object> (so no PDF fetch) at a narrow viewport", () => {
    stubMatchMedia(false);
    const { container } = render(<PdfEmbed src="/cms-assets/abc-123" />);
    expect(container.querySelector("object")).toBeNull();
  });

  it("renders the PDF <object> with a fallback link on a wide viewport", () => {
    stubMatchMedia(true);
    const { container } = render(<PdfEmbed src="/cms-assets/abc-123" />);
    const object = container.querySelector("object");
    expect(object?.getAttribute("data")).toBe("/cms-assets/abc-123");
    expect(object?.getAttribute("type")).toBe("application/pdf");
    expect(object?.querySelector('a[href="/cms-assets/abc-123"]')).not.toBeNull();
  });
});
