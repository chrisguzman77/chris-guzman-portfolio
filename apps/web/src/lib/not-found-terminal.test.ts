import { describe, expect, it } from "vitest";

import { runCommand, TERMINAL_PAGES } from "./not-found-terminal";

describe("runCommand", () => {
  it("lists the commands", () => {
    const { output } = runCommand("help");
    for (const command of ["help", "ls", "cd <page>", "cat resume", "whoami", "clear"]) {
      expect(output.join("\n")).toContain(command);
    }
  });

  it("lists every page", () => {
    expect(TERMINAL_PAGES).toEqual([
      "home",
      "experience",
      "education",
      "projects",
      "blog",
      "resume",
      "contact",
    ]);
    expect(runCommand("ls").output).toEqual([TERMINAL_PAGES.join("  ")]);
  });

  it("cd navigates to a page, however it is written", () => {
    expect(runCommand("cd projects").navigate).toBe("/projects");
    expect(runCommand("  CD  /blog/ ").navigate).toBe("/blog");
    expect(runCommand("cd ~/contact").navigate).toBe("/contact");
    expect(runCommand("cd home").navigate).toBe("/");
    expect(runCommand("cd ~").navigate).toBe("/");
    expect(runCommand("cd").navigate).toBe("/");
  });

  it("cd refuses pages that do not exist", () => {
    expect(runCommand("cd secrets")).toEqual({ output: ["cd: no such page: secrets"] });
  });

  it("cat resume opens the resume", () => {
    expect(runCommand("cat resume").navigate).toBe("/resume");
    expect(runCommand("cat resume.pdf").navigate).toBe("/resume");
    expect(runCommand("cat passwords.txt")).toEqual({
      output: ["cat: passwords.txt: No such file or directory"],
    });
  });

  it("whoami answers, clear clears, empty input does nothing", () => {
    expect(runCommand("whoami").output[0]).toBe("visitor");
    expect(runCommand("clear")).toEqual({ output: [], clear: true });
    expect(runCommand("   ")).toEqual({ output: [] });
  });

  it("anything else is not found, echoed back as plain text", () => {
    expect(runCommand("sudo rm -rf /")).toEqual({
      output: ["command not found: sudo (try help)"],
    });
    expect(runCommand("<img src=x onerror=alert(1)>").output).toEqual([
      "command not found: <img (try help)",
    ]);
  });
});
