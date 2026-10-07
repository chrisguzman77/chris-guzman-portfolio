// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatLauncher } from "./chat-launcher";

const route = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));

vi.mock("./chat-terminal", () => ({
  ChatTerminal: ({ hidden, onClose }: { hidden: boolean; onClose: () => void }) => (
    <section role="region" aria-label="Ask about Chris" hidden={hidden}>
      <button type="button" onClick={onClose}>
        Close terminal
      </button>
    </section>
  ),
}));

function stubDevice(platform: string, coarse = false) {
  Object.defineProperty(window.navigator, "platform", { value: platform, configurable: true });
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({ matches: query === "(pointer: coarse)" ? coarse : false })),
  );
}

async function renderLauncher() {
  await act(async () => {
    render(<ChatLauncher apiUrl="https://api.example.com" siteKey="k" suggestions={[]} />);
  });
}

const pill = () => screen.queryByRole("button", { name: /Ask about Chris/ });

beforeEach(() => stubDevice("MacIntel"));

afterEach(() => {
  cleanup();
  route.pathname = "/";
  vi.unstubAllGlobals();
  delete (window.navigator as { platform?: string }).platform; // back to jsdom's own getter
});

describe("ChatLauncher", () => {
  it.each([
    ["MacIntel", false, "⌘K"],
    ["Win32", false, "Ctrl K"],
    ["Linux x86_64", false, "Ctrl K"],
  ])("labels the shortcut on %s", async (platform, coarse, label) => {
    stubDevice(platform, coarse);
    await renderLauncher();
    expect(pill()?.querySelector("kbd")?.textContent).toBe(label);
  });

  it("gives the pill a visible focus ring", async () => {
    await renderLauncher();
    expect(pill()?.className).toContain("focus-visible:outline");
  });

  it("shows no shortcut on touch devices", async () => {
    stubDevice("iPhone", true);
    await renderLauncher();
    expect(pill()?.querySelector("kbd")).toBeNull();
    expect(pill()?.textContent).toBe("Ask about Chris");
  });

  it("opens the terminal on click and hides the pill", async () => {
    await renderLauncher();
    await act(async () => {
      fireEvent.click(pill()!);
    });
    expect(await screen.findByRole("region", { name: "Ask about Chris" })).toBeTruthy();
    expect(pill()).toBeNull();
  });

  it("toggles with ⌘K on Mac and ignores Ctrl+K there", async () => {
    await renderLauncher();
    await act(async () => {
      fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    });
    expect(screen.queryByRole("region")).toBeNull();
    await act(async () => {
      fireEvent.keyDown(window, { key: "k", metaKey: true });
    });
    expect(await screen.findByRole("region", { name: "Ask about Chris" })).toBeTruthy();
    await act(async () => {
      fireEvent.keyDown(window, { key: "k", metaKey: true });
    });
    expect(screen.getByRole("region", { hidden: true }).hidden).toBe(true);
    expect(pill()).toBeTruthy();
  });

  it("toggles with Ctrl+K on Windows", async () => {
    stubDevice("Win32");
    await renderLauncher();
    await act(async () => {
      fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    });
    expect(await screen.findByRole("region", { name: "Ask about Chris" })).toBeTruthy();
  });

  it("returns focus to the pill after closing", async () => {
    await renderLauncher();
    pill()!.focus();
    await act(async () => {
      fireEvent.click(pill()!);
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Close terminal" }));
    });
    expect(document.activeElement).toBe(pill());
  });

  it("closes on Escape from anywhere while open", async () => {
    await renderLauncher();
    await act(async () => {
      fireEvent.click(pill()!);
    });
    await screen.findByRole("region", { name: "Ask about Chris" });
    await act(async () => {
      fireEvent.keyDown(document.body, { key: "Escape" });
    });
    expect(screen.getByRole("region", { hidden: true }).hidden).toBe(true);
  });

  it("focuses the pill when the recorded focus target is the body", async () => {
    await renderLauncher();
    (document.activeElement as HTMLElement | null)?.blur();
    await act(async () => {
      fireEvent.click(pill()!); // Safari: the click does not focus the button
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Close terminal" }));
    });
    expect(document.activeElement).toBe(pill());
  });

  it("rests above the footer once the footer scrolls into view", async () => {
    const footer = document.createElement("footer");
    document.body.appendChild(footer);
    let top = window.innerHeight + 100; // below the fold
    footer.getBoundingClientRect = () => ({ top }) as DOMRect;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    await renderLauncher();
    expect(pill()?.style.transform).toBe("");
    top = window.innerHeight - 70; // footer is 70px into the viewport
    await act(async () => {
      fireEvent.scroll(window);
    });
    expect(pill()?.style.transform).toBe("translateY(-70px)");
    footer.remove();
  });

  describe("re-measures the footer when layout changes without a scroll", () => {
    let top: number;
    let footer: HTMLElement;
    const observers: { callback: () => void; target?: Element; disconnected: boolean }[] = [];

    beforeEach(() => {
      footer = document.createElement("footer");
      document.body.appendChild(footer);
      top = window.innerHeight + 100; // below the fold
      footer.getBoundingClientRect = () => ({ top }) as DOMRect;
      vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
        cb(0);
        return 1;
      });
      observers.length = 0;
      vi.stubGlobal(
        "ResizeObserver",
        class {
          entry: (typeof observers)[number];
          constructor(callback: () => void) {
            this.entry = { callback, disconnected: false };
            observers.push(this.entry);
          }
          observe(target: Element) {
            this.entry.target = target;
          }
          disconnect() {
            this.entry.disconnected = true;
          }
        },
      );
    });

    afterEach(() => footer.remove());

    it("when the body resizes", async () => {
      await renderLauncher();
      expect(pill()?.style.transform).toBe("");
      const live = observers.find((o) => !o.disconnected);
      expect(live?.target).toBe(document.body);
      top = window.innerHeight - 50; // content shrank: the footer is now in view
      await act(async () => {
        live!.callback();
      });
      expect(pill()?.style.transform).toBe("translateY(-50px)");
    });

    it("when the route changes", async () => {
      let rerender: ReturnType<typeof render>["rerender"] = () => {};
      await act(async () => {
        ({ rerender } = render(
          <ChatLauncher apiUrl="https://api.example.com" siteKey="k" suggestions={[]} />,
        ));
      });
      expect(pill()?.style.transform).toBe("");
      top = window.innerHeight - 40; // the new, shorter page's footer is in view
      route.pathname = "/education";
      await act(async () => {
        rerender(<ChatLauncher apiUrl="https://api.example.com" siteKey="k" suggestions={[]} />);
      });
      expect(pill()?.style.transform).toBe("translateY(-40px)");
    });

    it("disconnects its observer on unmount", async () => {
      await renderLauncher();
      cleanup();
      expect(observers.every((o) => o.disconnected)).toBe(true);
    });
  });

  it("carries the periodic glow effect", async () => {
    await renderLauncher();
    expect(pill()?.classList.contains("chat-pill-glow")).toBe(true);
  });
});

describe("ChatLauncher analytics", () => {
  const umamiTrack = vi.fn();

  beforeEach(() => {
    window.umami = { track: umamiTrack };
  });

  afterEach(() => {
    delete window.umami;
    umamiTrack.mockReset();
  });

  it("tracks chat-open when the pill opens the terminal", async () => {
    await renderLauncher();
    await act(async () => {
      fireEvent.click(pill()!);
    });
    expect(umamiTrack.mock.calls).toEqual([["chat-open"]]);
  });

  it("tracks chat-open when ⌘K opens the terminal, but not when ⌘K closes it", async () => {
    await renderLauncher();
    await act(async () => {
      fireEvent.keyDown(window, { key: "k", metaKey: true });
    });
    expect(await screen.findByRole("region", { name: "Ask about Chris" })).toBeTruthy();
    await act(async () => {
      fireEvent.keyDown(window, { key: "k", metaKey: true });
    });
    expect(umamiTrack.mock.calls).toEqual([["chat-open"]]);
  });
});
