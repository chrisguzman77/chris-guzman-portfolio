// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PdfEmbed } from "./pdf-embed";

afterEach(cleanup);

describe("PdfEmbed", () => {
  it("renders the PDF <object> with a fallback link at every width", () => {
    const { container } = render(<PdfEmbed src="/cms-assets/abc-123" />);
    const object = container.querySelector("object");
    expect(object?.getAttribute("data")).toBe("/cms-assets/abc-123#toolbar=0&view=Fit");
    expect(object?.getAttribute("type")).toBe("application/pdf");
    expect(object?.className).toContain("aspect-[8.5/11]");
    // No fixed height: the frame stays letter-shaped at every width.
    expect(object?.className).not.toMatch(/h-\[/);
    expect(object?.querySelector('a[href="/cms-assets/abc-123"]')).not.toBeNull();
  });
});
