// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ThemeToggle } from "./theme-toggle";

vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "dark", setTheme: vi.fn() }) }));

afterEach(cleanup);

describe("ThemeToggle", () => {
  it("has a visible focus ring", () => {
    render(<ThemeToggle />);
    expect(screen.getByRole("button", { name: "Toggle theme" }).className).toContain(
      "focus-visible:outline",
    );
  });
});
