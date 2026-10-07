// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SkipLink } from "./skip-link";

afterEach(cleanup);

describe("SkipLink", () => {
  it("is a link to the main landmark", () => {
    render(<SkipLink />);
    const link = screen.getAllByRole("link")[0];
    expect(link.textContent).toBe("Skip to content");
    expect(link.getAttribute("href")).toBe("#main");
  });
});
