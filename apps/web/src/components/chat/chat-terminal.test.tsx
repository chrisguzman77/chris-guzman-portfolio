// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CHAT_LIMITS, CHAT_MESSAGES } from "@/lib/chat";

import { ChatTerminal } from "./chat-terminal";

vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "dark" }) }));

const API = "https://api.example.com";
const fetchMock = vi.fn();
let tokenCallback: ((token: string) => void) | null = null;
const turnstile = {
  render: vi.fn((_el: HTMLElement, options: { callback: (t: string) => void }) => {
    tokenCallback = options.callback;
    options.callback("tok-1");
    return "widget-1";
  }),
  reset: vi.fn(() => tokenCallback?.("tok-2")),
  remove: vi.fn(),
};

function stubMotion(reduce: boolean, desktop = false) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches:
        query === "(prefers-reduced-motion: reduce)"
          ? reduce
          : query === "(min-width: 768px)"
            ? desktop
            : false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

function json(status: number, body: unknown) {
  return Promise.resolve(Response.json(body, { status }));
}

const SESSION = { session_id: "s-1", questions_left: 10 };
const ANSWER = {
  answer: "He built the ACM@AU API with FastAPI [1].",
  sources: [{ n: 1, title: "ACM@AU platform", url: "/projects/acm" }],
  outcome: "answered",
  questions_left: 9,
};

async function renderTerminal(props: Partial<Parameters<typeof ChatTerminal>[0]> = {}) {
  const onClose = vi.fn();
  await act(async () => {
    render(
      <ChatTerminal
        hidden={false}
        onClose={onClose}
        apiUrl={API}
        siteKey="site-key"
        suggestions={["What projects has Chris built?", "Is he open to internships?"]}
        {...props}
      />,
    );
  });
  return { onClose };
}

async function ask(text: string) {
  fireEvent.change(screen.getByLabelText("Ask a question about Chris"), {
    target: { value: text },
  });
  await act(async () => {
    fireEvent.submit(screen.getByRole("textbox").closest("form")!);
  });
}

beforeEach(() => {
  stubMotion(true);
  vi.stubGlobal("fetch", fetchMock);
  window.turnstile = turnstile;
  fetchMock.mockImplementation((url: string) =>
    url.endsWith("/v1/chat/sessions") ? json(201, SESSION) : json(200, ANSWER),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  fetchMock.mockReset();
  turnstile.render.mockClear();
  turnstile.reset.mockClear();
  tokenCallback = null;
  delete window.turnstile;
  window.localStorage.clear();
  delete window.umami;
});

describe("ChatTerminal", () => {
  it("renders the panel, welcome line and numbered suggestions, and opens a session", async () => {
    await renderTerminal();
    expect(screen.getByRole("region", { name: "Ask about Chris" })).toBeTruthy();
    expect(screen.getByText("TERMINAL")).toBeTruthy();
    expect(screen.getByText("ask-chris")).toBeTruthy();
    expect(screen.getByText(CHAT_MESSAGES.welcome)).toBeTruthy();
    expect(screen.getByRole("button", { name: "[1] What projects has Chris built?" })).toBeTruthy();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API}/v1/chat/sessions`);
    expect(JSON.parse(init.body as string)).toEqual({ turnstile_token: "tok-1" });
  });

  it("focuses the prompt when shown", async () => {
    await renderTerminal();
    expect(document.activeElement).toBe(screen.getByLabelText("Ask a question about Chris"));
  });

  it("asks a question and shows the answer with source links", async () => {
    await renderTerminal();
    await ask("  Has he used FastAPI?  ");
    expect(screen.getByText("Has he used FastAPI?")).toBeTruthy();
    expect(screen.getAllByText(ANSWER.answer).length).toBeGreaterThan(0);
    const link = screen.getByRole("link", { name: "[1] ACM@AU platform" });
    expect(link.getAttribute("href")).toBe("/projects/acm");
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe(`${API}/v1/chat/sessions/s-1/messages`);
    expect(JSON.parse(init.body as string)).toEqual({ question: "Has he used FastAPI?" });
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("");
  });

  it("announces only complete answers", async () => {
    await renderTerminal();
    await ask("FastAPI?");
    const live = document.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toBe(ANSWER.answer);
  });

  it("re-announces an identical consecutive answer", async () => {
    await renderTerminal();
    await ask("FastAPI?");
    const live = document.querySelector('[aria-live="polite"]');
    const first = live?.textContent;
    await ask("FastAPI?");
    const second = live?.textContent;
    expect(second).not.toBe(first); // an unchanged live region is not announced again
    expect(second?.replaceAll("\u200b", "")).toBe(ANSWER.answer);
  });

  it("submits a suggested question when clicked", async () => {
    await renderTerminal();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "[2] Is he open to internships?" }));
    });
    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ question: "Is he open to internships?" });
  });

  it("refuses questions over 500 characters without calling the API", async () => {
    await renderTerminal();
    await ask("x".repeat(501));
    expect(screen.getByText(CHAT_MESSAGES.tooLong)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1); // only the session
  });

  it("keeps the typed text when the question is too long to send", async () => {
    await renderTerminal();
    await ask("x".repeat(501));
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("x".repeat(501));
  });

  it("counts code points, not UTF-16 units, against the limit", async () => {
    await renderTerminal();
    await ask("😀".repeat(CHAT_LIMITS.question)); // 500 code points, 1000 UTF-16 units
    expect(screen.queryByText(CHAT_MESSAGES.tooLong)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await ask("😀".repeat(CHAT_LIMITS.question + 1));
    expect(screen.getByText(CHAT_MESSAGES.tooLong)).toBeTruthy();
  });

  it.each([
    [503, "budget_exhausted", CHAT_MESSAGES.budget],
    [503, "model_busy", CHAT_MESSAGES.busy],
    [429, "rate_limited", CHAT_MESSAGES.busy],
    [409, "session_limit", CHAT_MESSAGES.sessionLimit],
    [404, "session_not_found", CHAT_MESSAGES.ended],
    [503, "chat_unavailable", CHAT_MESSAGES.unavailable],
  ])("shows the line for %i %s", async (status, code, line) => {
    fetchMock.mockImplementation((url: string) =>
      url.endsWith("/v1/chat/sessions")
        ? json(201, SESSION)
        : json(status, { error: { code, message: "x" } }),
    );
    await renderTerminal();
    await ask("q?");
    expect(screen.getByText(line)).toBeTruthy();
  });

  it("shows the unavailable line when the session cannot be opened", async () => {
    fetchMock.mockImplementation(() => json(503, { error: { code: "chat_disabled" } }));
    await renderTerminal();
    expect(screen.getByText(CHAT_MESSAGES.unavailable)).toBeTruthy();
  });

  it("types answers out unless reduced motion is on", async () => {
    stubMotion(false);
    vi.useFakeTimers();
    await renderTerminal();
    await ask("FastAPI?");
    const visible = () => document.querySelector("[data-typed]")?.textContent ?? "";
    expect(visible().length).toBeLessThan(ANSWER.answer.length);
    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });
    expect(visible()).toBe(ANSWER.answer);
  });

  it("clear empties the transcript and opens a new session", async () => {
    await renderTerminal();
    await ask("FastAPI?");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Clear and start a new session" }));
    });
    expect(screen.queryByText("FastAPI?")).toBeNull();
    expect(turnstile.reset).toHaveBeenCalled();
    const sessionCalls = fetchMock.mock.calls.filter(([u]) =>
      String(u).endsWith("/v1/chat/sessions"),
    );
    expect(sessionCalls).toHaveLength(2);
    expect(JSON.parse((sessionCalls[1][1] as RequestInit).body as string)).toEqual({
      turnstile_token: "tok-2",
    });
  });

  it("closes on Escape and the close button", async () => {
    const { onClose } = await renderTerminal();
    fireEvent.keyDown(screen.getByRole("region", { name: "Ask about Chris" }), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Close terminal" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("is hidden but keeps its transcript when hidden", async () => {
    await renderTerminal({ hidden: true });
    const region = screen.getByRole("region", { hidden: true });
    expect(region.hidden).toBe(true);
  });

  it("resizes from the keyboard, remembers the height, and maximizes", async () => {
    await renderTerminal();
    const handle = screen.getByRole("separator", { name: "Resize terminal" });
    expect(handle.getAttribute("aria-valuenow")).toBe("40");
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    expect(handle.getAttribute("aria-valuenow")).toBe("45");
    expect(window.localStorage.getItem("chat-panel-height")).toBe("45");
    fireEvent.click(screen.getByRole("button", { name: "Maximize terminal" }));
    expect(handle.getAttribute("aria-valuenow")).toBe("90");
    expect(screen.getByRole("button", { name: "Restore terminal size" })).toBeTruthy();
  });

  it.each(["pointerUp", "pointerCancel"] as const)(
    "ends a drag on %s: saves the height and ignores later moves",
    async (end) => {
      await renderTerminal();
      const handle = screen.getByRole("separator", { name: "Resize terminal" });
      Object.defineProperty(window, "innerHeight", { value: 1000, configurable: true });
      fireEvent.pointerDown(handle, { pointerId: 1 });
      fireEvent.pointerMove(handle, { clientY: 500 });
      expect(handle.getAttribute("aria-valuenow")).toBe("50");
      fireEvent[end](handle, { pointerId: 1 });
      expect(window.localStorage.getItem("chat-panel-height")).toBe("50");
      fireEvent.pointerMove(handle, { clientY: 200 });
      expect(handle.getAttribute("aria-valuenow")).toBe("50");
    },
  );

  it("starts at the remembered height, clamped to 25-90", async () => {
    window.localStorage.setItem("chat-panel-height", "120");
    await renderTerminal();
    expect(
      screen.getByRole("separator", { name: "Resize terminal" }).getAttribute("aria-valuenow"),
    ).toBe("90");
  });

  it("uses the dark palette on pure black whatever the site theme", async () => {
    await renderTerminal();
    const region = screen.getByRole("region", { name: "Ask about Chris" });
    expect(region.classList.contains("dark")).toBe(true);
    expect(region.classList.contains("bg-terminal")).toBe(true);
  });

  it.each([
    ["closes the panel on a phone so the opened page is visible", false, 1],
    ["keeps the panel open on desktop", true, 0],
  ])("source link click: %s", async (_name, desktop, closes) => {
    stubMotion(true, desktop);
    const { onClose } = await renderTerminal();
    await ask("FastAPI?");
    await act(async () => {
      fireEvent.click(screen.getByRole("link", { name: "[1] ACM@AU platform" }));
    });
    expect(onClose).toHaveBeenCalledTimes(closes);
  });

  it("clear while a question is pending drops the stale answer", async () => {
    let resolveAnswer: (r: Response) => void = () => {};
    fetchMock.mockImplementation((url: string) =>
      url.endsWith("/v1/chat/sessions")
        ? json(201, SESSION)
        : new Promise<Response>((resolve) => {
            resolveAnswer = resolve;
          }),
    );
    await renderTerminal();
    await ask("FastAPI?");
    expect(screen.getByText(CHAT_MESSAGES.thinking)).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Clear and start a new session" }));
    });
    expect(screen.queryByText(CHAT_MESSAGES.thinking)).toBeNull();
    await act(async () => {
      resolveAnswer(Response.json(ANSWER));
    });
    expect(screen.queryByText(ANSWER.answer)).toBeNull();
    expect(screen.queryByRole("link", { name: "[1] ACM@AU platform" })).toBeNull();
  });

  it("clear while the session is opening ignores the stale session", async () => {
    let resolveFirst: (r: Response) => void = () => {};
    let sessionCalls = 0;
    fetchMock.mockImplementation((url: string) => {
      if (!url.endsWith("/v1/chat/sessions")) return json(200, ANSWER);
      sessionCalls += 1;
      return sessionCalls === 1
        ? new Promise<Response>((resolve) => {
            resolveFirst = resolve;
          })
        : json(201, { session_id: "s-2", questions_left: 10 });
    });
    await renderTerminal();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Clear and start a new session" }));
    });
    await act(async () => {
      resolveFirst(Response.json({ session_id: "s-1", questions_left: 10 }, { status: 201 }));
    });
    await ask("FastAPI?");
    const [url] = fetchMock.mock.calls.at(-1) as [string];
    expect(url).toBe(`${API}/v1/chat/sessions/s-2/messages`);
  });
});

describe("ChatTerminal analytics", () => {
  it("tracks chat-question with no data, never the question text", async () => {
    const umamiTrack = vi.fn();
    window.umami = { track: umamiTrack };
    await renderTerminal();
    await ask("Has he used FastAPI? My email is ada@example.com");
    expect(umamiTrack.mock.calls).toEqual([["chat-question"]]);
  });

  it("tracks a clicked suggestion as a question", async () => {
    const umamiTrack = vi.fn();
    window.umami = { track: umamiTrack };
    await renderTerminal();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "[1] What projects has Chris built?" }));
    });
    expect(umamiTrack.mock.calls).toEqual([["chat-question"]]);
  });

  it("does not track a question that is too long to send", async () => {
    const umamiTrack = vi.fn();
    window.umami = { track: umamiTrack };
    await renderTerminal();
    await ask("x".repeat(CHAT_LIMITS.question + 1));
    expect(umamiTrack).not.toHaveBeenCalled();
  });
});
