// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { outboundProps, outboundTargetFor, track } from "./analytics";

afterEach(() => {
  delete window.umami;
});

describe("track", () => {
  it("does nothing when the Umami tracker has not loaded", () => {
    expect(window.umami).toBeUndefined();
    expect(() => track("chat-open")).not.toThrow();
    expect(() => track("resume-download", { from: "/" })).not.toThrow();
  });

  it("sends events without data as a bare name", () => {
    const umamiTrack = vi.fn();
    window.umami = { track: umamiTrack };
    track("chat-question");
    expect(umamiTrack.mock.calls).toEqual([["chat-question"]]);
  });

  it("sends event data when the event has some", () => {
    const umamiTrack = vi.fn();
    window.umami = { track: umamiTrack };
    track("resume-download", { from: "/experience" });
    expect(umamiTrack.mock.calls).toEqual([["resume-download", { from: "/experience" }]]);
  });
});

describe("outboundProps", () => {
  it("returns Umami's declarative click attributes", () => {
    expect(outboundProps("repo")).toEqual({
      "data-umami-event": "outbound-click",
      "data-umami-event-to": "repo",
    });
  });
});

describe("outboundTargetFor", () => {
  it.each([
    ["https://github.com/octo", "github"],
    ["https://www.github.com/octo", "github"],
    ["https://www.linkedin.com/in/someone/", "linkedin"],
    ["https://linkedin.com/in/someone", "linkedin"],
    ["https://notgithub.com/octo", "other"],
    ["https://example.com", "other"],
    ["http//broken", "other"],
  ])("%s -> %s", (href, to) => {
    expect(outboundTargetFor(href)).toBe(to);
  });
});
