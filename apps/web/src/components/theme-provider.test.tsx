// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import { describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "./theme-provider";

vi.mock("next-themes", () => ({
  ThemeProvider: vi.fn(({ children }: { children: React.ReactNode }) => children),
}));

describe("ThemeProvider", () => {
  it("defaults first-time visitors to dark, ignores the OS theme, and skips transitions", () => {
    render(
      <ThemeProvider>
        <p>child</p>
      </ThemeProvider>,
    );
    expect(screen.getByText("child")).toBeTruthy();
    expect(vi.mocked(NextThemesProvider).mock.calls[0][0]).toMatchObject({
      attribute: "class",
      defaultTheme: "dark",
      enableSystem: false,
      disableTransitionOnChange: true,
    });
  });
});
