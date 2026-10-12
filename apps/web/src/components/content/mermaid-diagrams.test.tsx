// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MermaidDiagrams } from "./mermaid-diagrams";

const state = vi.hoisted(() => ({ loaded: false, theme: "dark" }));
const mermaid = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn() }));

vi.mock("mermaid", () => {
  state.loaded = true;
  return { default: mermaid };
});
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: state.theme }) }));

const SOURCE = "flowchart LR\n  A --> B\n";

function addBlock() {
  const prose = document.createElement("div");
  prose.className = "prose-content";
  prose.innerHTML = `<pre class="mermaid-source" data-mermaid="">${SOURCE}</pre>`;
  document.body.append(prose);
  return prose.querySelector("pre")!;
}

beforeEach(() => {
  // Re-evaluate the mocked module on each import, so `state.loaded` reflects this test only.
  vi.resetModules();
  state.loaded = false;
  state.theme = "dark";
  mermaid.render.mockResolvedValue({ svg: '<svg role="img"><text>diagram</text></svg>' });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("MermaidDiagrams", () => {
  it("never loads mermaid when the page has no diagram", async () => {
    render(<MermaidDiagrams />);
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(state.loaded).toBe(false);
    expect(mermaid.initialize).not.toHaveBeenCalled();
  });

  it("renders each block after its pre and hides the source", async () => {
    const pre = addBlock();
    render(<MermaidDiagrams />);
    await waitFor(() => expect(pre.hidden).toBe(true));
    expect(mermaid.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ startOnLoad: false, securityLevel: "strict", theme: "base" }),
    );
    expect(mermaid.render).toHaveBeenCalledWith(expect.any(String), SOURCE);
    const rendered = pre.nextElementSibling;
    expect(rendered?.hasAttribute("data-mermaid-rendered")).toBe(true);
    expect(rendered?.querySelector("svg")).toBeTruthy();
  });

  it("leaves the source visible and cleans up when rendering fails", async () => {
    const consoleError = vi.spyOn(console, "error");
    mermaid.render.mockImplementation(async (id: string) => {
      const leftover = document.createElement("div");
      leftover.id = `d${id}`;
      document.body.append(leftover);
      throw new Error("Parse error on line 1");
    });
    const pre = addBlock();
    render(<MermaidDiagrams />);
    await waitFor(() => expect(mermaid.render).toHaveBeenCalled());
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    const id = mermaid.render.mock.calls[0][0] as string;
    expect(pre.hidden).toBe(false);
    expect(document.querySelector("[data-mermaid-rendered]")).toBeNull();
    expect(document.getElementById(`d${id}`)).toBeNull();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("re-renders from the original source when the theme changes", async () => {
    const pre = addBlock();
    const { rerender } = render(<MermaidDiagrams />);
    await waitFor(() => expect(pre.hidden).toBe(true));
    state.theme = "light";
    mermaid.render.mockResolvedValue({ svg: "<svg><text>light</text></svg>" });
    rerender(<MermaidDiagrams />);
    await waitFor(() => expect(document.body.textContent).toContain("light"));
    expect(mermaid.render).toHaveBeenCalledTimes(2);
    expect(mermaid.render).toHaveBeenLastCalledWith(expect.any(String), SOURCE);
    expect(document.querySelectorAll("[data-mermaid-rendered]")).toHaveLength(1);
    expect(pre.hidden).toBe(true);
  });
});
