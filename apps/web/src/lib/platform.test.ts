import { describe, expect, it } from "vitest";

import { isApplePlatform, isChatShortcut, shortcutLabel } from "./platform";

const key = (over: Partial<KeyboardEvent>) =>
  ({ key: "k", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...over }) as Pick<
    KeyboardEvent,
    "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"
  >;

describe("platform", () => {
  it.each([
    ["MacIntel", true],
    ["macOS", true],
    ["iPhone", true],
    ["iPad", true],
    ["Win32", false],
    ["Windows", false],
    ["Linux x86_64", false],
    ["", false],
  ])("isApplePlatform(%s) is %s", (platform, apple) => {
    expect(isApplePlatform(platform)).toBe(apple);
  });

  it("labels the shortcut per platform and hides it on touch devices", () => {
    expect(shortcutLabel("MacIntel", false)).toBe("⌘K");
    expect(shortcutLabel("Win32", false)).toBe("Ctrl K");
    expect(shortcutLabel("Linux x86_64", false)).toBe("Ctrl K");
    expect(shortcutLabel("MacIntel", true)).toBeNull();
  });

  it("matches ⌘K on Apple and Ctrl+K elsewhere, nothing else", () => {
    expect(isChatShortcut(key({ metaKey: true }), true)).toBe(true);
    expect(isChatShortcut(key({ key: "K", metaKey: true }), true)).toBe(true);
    expect(isChatShortcut(key({ ctrlKey: true }), true)).toBe(false);
    expect(isChatShortcut(key({ ctrlKey: true }), false)).toBe(true);
    expect(isChatShortcut(key({ metaKey: true }), false)).toBe(false);
    expect(isChatShortcut(key({ ctrlKey: true, shiftKey: true }), false)).toBe(false);
    expect(isChatShortcut(key({ ctrlKey: true, altKey: true }), false)).toBe(false);
    expect(isChatShortcut(key({ key: "j", ctrlKey: true }), false)).toBe(false);
  });
});
