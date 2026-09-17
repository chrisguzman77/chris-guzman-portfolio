// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SiteHeader } from "./site-header";

describe("SiteHeader", () => {
  it("links the site name to the home page and exposes the theme toggle", () => {
    render(<SiteHeader />);
    expect(screen.getByRole("link", { name: "Christopher Guzman" }).getAttribute("href")).toBe("/");
    expect(screen.getByRole("button", { name: /toggle theme/i })).toBeTruthy();
  });
});
