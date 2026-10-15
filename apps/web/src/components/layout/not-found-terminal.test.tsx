// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NotFoundTerminal } from "./not-found-terminal";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  usePathname: () => "/nope",
  useRouter: () => ({ push }),
}));

afterEach(() => {
  cleanup();
  push.mockReset();
});

function run(command: string) {
  const input = screen.getByRole("textbox", { name: /terminal command/i });
  fireEvent.change(input, { target: { value: command } });
  fireEvent.submit(input.closest("form")!);
}

describe("NotFoundTerminal", () => {
  it("reports the missing path", () => {
    render(<NotFoundTerminal />);
    expect(screen.getByText("bash: /nope: No such file or directory (404)")).toBeTruthy();
  });

  it("echoes each command with its output in a polite live region", () => {
    const { container } = render(<NotFoundTerminal />);
    run("ls");
    const log = container.querySelector("[aria-live='polite']")!;
    expect(log.textContent).toContain("visitor@chris:~$ ls");
    expect(log.textContent).toContain("projects");
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("");
  });

  it("navigates on cd", () => {
    render(<NotFoundTerminal />);
    run("cd projects");
    expect(push).toHaveBeenCalledWith("/projects");
  });

  it("clear empties the log", () => {
    const { container } = render(<NotFoundTerminal />);
    run("help");
    run("clear");
    expect(container.querySelector("[aria-live='polite']")!.textContent).toBe("");
  });

  it("prints input as text, never as markup", () => {
    const { container } = render(<NotFoundTerminal />);
    run("<img src=x onerror=alert(1)>");
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
  });
});
