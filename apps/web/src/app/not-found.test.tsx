// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import NotFound from "./not-found";

afterEach(cleanup);

describe("not-found", () => {
  it("shows the terminal prompt and title", () => {
    render(<NotFound />);

    expect(screen.getByText("$ cd: no such page")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Page not found" })).toBeTruthy();
  });

  it("links to the main pages", () => {
    render(<NotFound />);

    const hrefs = screen
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"))
      .sort();
    expect(hrefs).toEqual(["/", "/blog", "/contact", "/projects"]);
  });
});
