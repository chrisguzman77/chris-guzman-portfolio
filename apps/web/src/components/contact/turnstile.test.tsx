// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Turnstile } from "./turnstile";

afterEach(() => {
  cleanup();
  delete window.turnstile;
});

describe("Turnstile", () => {
  it("clears the token when the widget is removed, e.g. on a theme change", async () => {
    const api = {
      render: vi.fn((_el: HTMLElement, options: { callback: (t: string) => void }) => {
        options.callback("tok-1");
        return "widget-1";
      }),
      reset: vi.fn(),
      remove: vi.fn(),
    };
    window.turnstile = api;
    const onToken = vi.fn();
    const props = { siteKey: "k", resetSignal: 0, onToken, onError: vi.fn() };
    let view: ReturnType<typeof render> | undefined;
    await act(async () => {
      view = render(<Turnstile {...props} theme="dark" />);
    });
    expect(onToken).toHaveBeenLastCalledWith("tok-1");
    onToken.mockClear();
    api.render.mockImplementation(() => "widget-2");
    await act(async () => {
      view?.rerender(<Turnstile {...props} theme="light" />);
    });
    expect(api.remove).toHaveBeenCalledWith("widget-1");
    expect(onToken).toHaveBeenCalledWith(null);
    expect(onToken).not.toHaveBeenCalledWith("tok-1");
  });
});
