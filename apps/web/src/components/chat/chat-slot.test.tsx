// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getChatSettings } from "@/lib/directus/queries";

import { ChatSlot } from "./chat-slot";

vi.mock("@/lib/directus/queries", () => ({ getChatSettings: vi.fn() }));
vi.mock("./chat-launcher", () => ({
  ChatLauncher: (props: { apiUrl: string; siteKey: string; suggestions: string[] }) => (
    <div data-testid="launcher">{JSON.stringify(props)}</div>
  ),
}));

const settings = vi.mocked(getChatSettings);

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  settings.mockReset();
});

describe("ChatSlot", () => {
  it("renders the launcher with the API URL, site key and up to four suggestions", async () => {
    vi.stubEnv("TURNSTILE_SITE_KEY", "site-key");
    vi.stubEnv("PUBLIC_API_URL", "https://api.example.com");
    settings.mockResolvedValue({ enabled: true, suggested_questions: ["1", "2", "3", "4", "5"] });
    render(await ChatSlot());
    expect(JSON.parse(screen.getByTestId("launcher").textContent ?? "")).toEqual({
      apiUrl: "https://api.example.com",
      siteKey: "site-key",
      suggestions: ["1", "2", "3", "4"],
    });
  });

  it.each([
    ["chat is switched off", { enabled: false, suggested_questions: [] }, "site-key"],
    ["Directus is unreachable", null, "site-key"],
    ["there is no Turnstile site key", { enabled: true, suggested_questions: [] }, ""],
  ])("renders nothing when %s", async (_label, value, siteKey) => {
    vi.stubEnv("TURNSTILE_SITE_KEY", siteKey);
    settings.mockResolvedValue(value);
    const { container } = render(<>{await ChatSlot()}</>);
    expect(container.innerHTML).toBe("");
  });
});
