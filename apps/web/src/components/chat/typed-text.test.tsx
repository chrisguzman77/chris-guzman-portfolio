// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TypedText } from "./typed-text";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("TypedText", () => {
  it("types the text out and stops its timer from an effect cleanup, not the state updater", () => {
    vi.useFakeTimers();
    const clear = vi.spyOn(globalThis, "clearInterval");
    const { container } = render(
      <StrictMode>
        <TypedText text="hello world" animate />
      </StrictMode>,
    );
    expect(container.textContent).toBe("");
    act(() => {
      vi.advanceTimersByTime(12 * 10);
    });
    expect(container.textContent).toBe("hello world");

    // StrictMode runs updaters twice, so a clearInterval inside one clears the same timer twice.
    const ids = clear.mock.calls.map(([id]) => id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shows the whole text at once without animation", () => {
    const { container } = render(<TypedText text="hello" animate={false} />);
    expect(container.textContent).toBe("hello");
  });
});
