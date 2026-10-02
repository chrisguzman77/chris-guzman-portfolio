// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CopyEmail } from "./copy-email";

function setClipboard(value: unknown) {
  Object.defineProperty(window.navigator, "clipboard", { value, configurable: true });
}

// Clicks and lets the awaited clipboard promise settle inside act(), so the state
// update is applied before the next assertion without polling.
async function click(name: string | RegExp) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

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

    await click("Copy");

    expect(writeText).toHaveBeenCalledWith("chguzman@augusta.edu");
    expect(screen.getByText("Copied").getAttribute("aria-live")).toBe("polite");
  });

  it("returns to 'Copy' after 2 seconds", async () => {
    setClipboard({ writeText: vi.fn().mockResolvedValue(undefined) });
    render(<CopyEmail email="chguzman@augusta.edu" />);

    await click("Copy");
    advance(1999);
    expect(screen.getByText("Copied")).toBeTruthy();
    advance(1);

    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
    expect(screen.queryByText("Copied")).toBeNull();
  });

  it("restarts the 2 second window on a second click", async () => {
    setClipboard({ writeText: vi.fn().mockResolvedValue(undefined) });
    render(<CopyEmail email="chguzman@augusta.edu" />);

    await click("Copy");
    advance(1500);
    await click("Copied");
    advance(1000);
    expect(screen.getByText("Copied")).toBeTruthy();
    advance(1000);

    expect(screen.queryByText("Copied")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the pending reset timer on unmount", async () => {
    setClipboard({ writeText: vi.fn().mockResolvedValue(undefined) });
    const { unmount } = render(<CopyEmail email="chguzman@augusta.edu" />);

    await click("Copy");
    expect(vi.getTimerCount()).toBe(1);
    unmount();

    expect(vi.getTimerCount()).toBe(0);
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

    await click("Copy");

    const link = screen.getByRole("link", { name: /send email/i });
    expect(link.getAttribute("href")).toBe("mailto:chguzman@augusta.edu");
  });
});
