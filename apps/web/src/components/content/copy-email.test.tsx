// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CopyEmail } from "./copy-email";

function setClipboard(value: unknown) {
  Object.defineProperty(window.navigator, "clipboard", { value, configurable: true });
}

afterEach(() => {
  cleanup();
  setClipboard(undefined);
  vi.useRealTimers();
});

describe("CopyEmail", () => {
  it("copies the address and confirms with a polite live region", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    render(<CopyEmail email="chguzman@augusta.edu" />);

    fireEvent.click(screen.getByRole("button", { name: "Copy address" }));

    const copied = await screen.findByText("Copied");
    expect(writeText).toHaveBeenCalledWith("chguzman@augusta.edu");
    expect(copied.getAttribute("aria-live")).toBe("polite");
  });

  it("returns to 'Copy address' after 2 seconds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setClipboard({ writeText: vi.fn().mockResolvedValue(undefined) });
    render(<CopyEmail email="chguzman@augusta.edu" />);

    fireEvent.click(screen.getByRole("button", { name: "Copy address" }));
    await screen.findByText("Copied");
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.getByRole("button", { name: "Copy address" })).toBeTruthy();
    expect(screen.queryByText("Copied")).toBeNull();
  });

  it("falls back to a mailto link when the clipboard API is unavailable", () => {
    setClipboard(undefined);
    render(<CopyEmail email="chguzman@augusta.edu" />);

    expect(screen.queryByRole("button")).toBeNull();
    const link = screen.getByRole("link", { name: /send email/i });
    expect(link.getAttribute("href")).toBe("mailto:chguzman@augusta.edu");
  });

  it("falls back to a mailto link when copying fails", async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error("denied")) });
    render(<CopyEmail email="chguzman@augusta.edu" />);

    fireEvent.click(screen.getByRole("button", { name: "Copy address" }));

    const link = await screen.findByRole("link", { name: /send email/i });
    expect(link.getAttribute("href")).toBe("mailto:chguzman@augusta.edu");
  });
});
