// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Prose } from "./prose";

vi.mock("./mermaid-diagrams", () => ({
  MermaidDiagrams: () => <span data-testid="mermaid-diagrams" />,
}));

afterEach(cleanup);

describe("Prose", () => {
  it("adds the diagram renderer when the HTML has a mermaid block", () => {
    render(<Prose html={'<pre class="mermaid-source" data-mermaid="">graph TD</pre>'} />);
    expect(screen.getByTestId("mermaid-diagrams")).toBeTruthy();
  });

  it("leaves it out otherwise", () => {
    const { container } = render(<Prose html="<p>No diagrams here.</p>" />);
    expect(container.textContent).toBe("No diagrams here.");
    expect(screen.queryByTestId("mermaid-diagrams")).toBeNull();
  });
});
