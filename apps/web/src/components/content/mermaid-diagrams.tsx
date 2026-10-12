"use client";

import { useTheme } from "next-themes";
import { useEffect, useRef } from "react";

const FALLBACK_FONT = "ui-sans-serif, system-ui, sans-serif";

let nextId = 0;

// Mermaid derives its palette from real colors, so read the theme tokens' computed values.
function themeVariables() {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string) => style.getPropertyValue(`--${name}`).trim();
  return {
    background: token("background"),
    primaryColor: token("card"),
    primaryTextColor: token("foreground"),
    primaryBorderColor: token("accent-brand"),
    secondaryColor: token("muted"),
    tertiaryColor: token("background"),
    lineColor: token("muted-foreground"),
    textColor: token("foreground"),
    mainBkg: token("card"),
    nodeBorder: token("accent-brand"),
    clusterBkg: token("muted"),
    clusterBorder: token("border"),
    edgeLabelBackground: token("background"),
    titleColor: token("foreground"),
    noteBkgColor: token("muted"),
    noteTextColor: token("foreground"),
    noteBorderColor: token("input"),
  };
}

async function renderDiagrams(blocks: HTMLPreElement[], dark: boolean, isStale: () => boolean) {
  const { default: mermaid } = await import("mermaid");
  // Wait for web fonts so Mermaid sizes labels with the real font. By now next-themes has also
  // applied the theme class (its effect runs after this child's), so the tokens are current.
  await document.fonts?.ready;
  if (isStale()) return;
  mermaid.initialize({
    startOnLoad: false,
    suppressErrorRendering: true,
    securityLevel: "strict",
    theme: "base",
    fontFamily: getComputedStyle(document.documentElement).fontFamily || FALLBACK_FONT,
    themeVariables: { ...themeVariables(), darkMode: dark },
  });

  for (const pre of blocks) {
    // The hidden pre keeps the original source, so a re-render never depends on the last SVG.
    const source = pre.textContent ?? "";
    const previous = pre.nextElementSibling?.hasAttribute("data-mermaid-rendered")
      ? pre.nextElementSibling
      : null;
    const id = `mermaid-diagram-${++nextId}`;
    try {
      const { svg } = await mermaid.render(id, source);
      if (isStale()) return;
      const container = document.createElement("div");
      container.setAttribute("data-mermaid-rendered", "");
      // Mermaid's strict security level runs its output through DOMPurify.
      container.innerHTML = svg;
      previous?.remove();
      pre.after(container);
      pre.hidden = true;
    } catch {
      // Mermaid can leave its temporary or error diagram in <body>. No console.error: the
      // source stays visible as the fallback.
      document.getElementById(`d${id}`)?.remove();
      document.getElementById(id)?.remove();
      if (isStale()) return;
      previous?.remove();
      pre.hidden = false;
    }
  }
}

// Renders the ```mermaid blocks (see renderMarkdown) of the Prose container that directly
// precedes it, so several Prose blocks on one page never render each other's diagrams. Mermaid is
// only downloaded when one exists; the theme is a dependency so diagrams follow light/dark mode.
export function MermaidDiagrams() {
  const { resolvedTheme } = useTheme();
  const marker = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const blocks = Array.from(
      marker.current?.previousElementSibling?.querySelectorAll<HTMLPreElement>(
        "pre[data-mermaid]",
      ) ?? [],
    );
    if (blocks.length === 0) return;
    let stale = false;
    void renderDiagrams(blocks, resolvedTheme === "dark", () => stale);
    return () => {
      stale = true;
    };
  }, [resolvedTheme]);

  return <span hidden ref={marker} />;
}
