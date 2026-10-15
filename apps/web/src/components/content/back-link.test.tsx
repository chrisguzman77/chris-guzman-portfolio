// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { BackLink } from "./back-link";

afterEach(cleanup);

describe("BackLink", () => {
  it("is one link to the parent list, named for screen readers", () => {
    render(<BackLink href="/blog" label="blog" />);
    const link = screen.getByRole("link", { name: "cd .. (back to blog)" });
    expect(link.getAttribute("href")).toBe("/blog");
    expect(link.textContent).toBe("←cd ..");
    expect(link.querySelector(".back-key-box")?.textContent).toBe("cd ..");
    expect(link.className).toContain("focus-visible:outline");
  });
});
