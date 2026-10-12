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

const BLOCK = `<pre class="mermaid-source" data-mermaid="">${SOURCE}</pre>`;

// Mirrors <Prose>: the prose div, then MermaidDiagrams' marker as its next sibling.
function Page({ html }: { html: string }) {
  return (
    <>
      <div className="prose-content" dangerouslySetInnerHTML={{ __html: html }} />
      <MermaidDiagrams />
    </>
  );
}

function mount(html = BLOCK) {
  const host = document.createElement("div");
  document.body.append(host);
  const view = render(<Page html={html} />, { container: host });
  return { ...view, pre: host.querySelector("pre")!, host };
}

beforeEach(() => {
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
    // Re-evaluate the mocked module on import, so `state.loaded` reflects this test only.
    vi.resetModules();
    mount("<p>none</p>");
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(state.loaded).toBe(false);
    expect(mermaid.initialize).not.toHaveBeenCalled();
  });

  it("renders each block after its pre and hides the source", async () => {
    const { pre } = mount();
    await waitFor(() => expect(pre.hidden).toBe(true));
    expect(mermaid.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        startOnLoad: false,
        suppressErrorRendering: true,
        securityLevel: "strict",
        theme: "base",
      }),
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
    const { pre } = mount();
    await waitFor(() => expect(mermaid.render).toHaveBeenCalled());
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    const id = mermaid.render.mock.calls[0][0] as string;
    expect(pre.hidden).toBe(false);
    expect(document.querySelector("[data-mermaid-rendered]")).toBeNull();
    expect(document.getElementById(`d${id}`)).toBeNull();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("re-renders from the original source when the theme changes", async () => {
    const { pre, rerender } = mount();
    await waitFor(() => expect(pre.hidden).toBe(true));
    state.theme = "light";
    mermaid.render.mockResolvedValue({ svg: "<svg><text>light</text></svg>" });
    rerender(<Page html={BLOCK} />);
    await waitFor(() => expect(document.body.textContent).toContain("light"));
    expect(mermaid.render).toHaveBeenCalledTimes(2);
    expect(mermaid.render).toHaveBeenLastCalledWith(expect.any(String), SOURCE);
    expect(document.querySelectorAll("[data-mermaid-rendered]")).toHaveLength(1);
    expect(pre.hidden).toBe(true);
  });

  it("renders only its own Prose container, even with several on the page", async () => {
    const first = mount();
    await waitFor(() => expect(first.pre.hidden).toBe(true));
    const second = mount();
    await waitFor(() => expect(second.pre.hidden).toBe(true));
    expect(document.querySelectorAll("[data-mermaid-rendered]")).toHaveLength(2);
    expect(first.host.querySelectorAll("[data-mermaid-rendered]")).toHaveLength(1);
    expect(second.host.querySelectorAll("[data-mermaid-rendered]")).toHaveLength(1);

    state.theme = "light";
    first.rerender(<Page html={BLOCK} />);
    await waitFor(() => expect(mermaid.render).toHaveBeenCalledTimes(3));
    second.rerender(<Page html={BLOCK} />);
    await waitFor(() => expect(mermaid.render).toHaveBeenCalledTimes(4));
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(first.host.querySelectorAll("[data-mermaid-rendered]")).toHaveLength(1);
    expect(second.host.querySelectorAll("[data-mermaid-rendered]")).toHaveLength(1);
  });
});
