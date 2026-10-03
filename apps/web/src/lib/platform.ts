type ShortcutEvent = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">;

export function isApplePlatform(platform: string): boolean {
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** "⌘K" on Apple platforms, "Ctrl K" elsewhere, null on touch devices (no keyboard). */
export function shortcutLabel(platform: string, coarsePointer: boolean): string | null {
  if (coarsePointer) return null;
  return isApplePlatform(platform) ? "⌘K" : "Ctrl K";
}

export function isChatShortcut(event: ShortcutEvent, apple: boolean): boolean {
  if (event.key.toLowerCase() !== "k" || event.altKey || event.shiftKey) return false;
  return apple ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}

export function currentPlatform(): string {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return nav.userAgentData?.platform || nav.platform || "";
}
