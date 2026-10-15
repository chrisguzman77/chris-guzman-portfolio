import { describe, expect, it } from "vitest";

import { logoCrumb, logoSuffix, nextFrame } from "./logo-path";

describe("logoSuffix", () => {
  it("is empty at home", () => {
    expect(logoSuffix("/")).toBe("");
  });

  it("shows the first path segment of a known section", () => {
    expect(logoSuffix("/projects")).toBe("/projects");
    expect(logoSuffix("/projects/offres-offpay")).toBe("/projects/offres-offpay.md");
    expect(logoSuffix("/blog/hello-world")).toBe("/blog/hello-world.md");
    expect(logoSuffix("/newsletter/confirm")).toBe("/newsletter");
  });

  it("keeps the section for deeper paths", () => {
    expect(logoSuffix("/blog/a/b")).toBe("/blog");
  });

  it("shows /404 for an unknown section", () => {
    expect(logoSuffix("/nope")).toBe("/404");
    expect(logoSuffix("/nope/deeper")).toBe("/404");
  });
});

describe("logoCrumb", () => {
  it("is the section prefix on a detail path only", () => {
    expect(logoCrumb("/blog/how-i-built-this-site.md")).toBe("/blog");
    expect(logoCrumb("/projects/this-portfolio.md")).toBe("/projects");
    expect(logoCrumb("/projects")).toBeNull();
    expect(logoCrumb("/404")).toBeNull();
    expect(logoCrumb("")).toBeNull();
  });
});

describe("nextFrame", () => {
  it("deletes back to the shared prefix, then types the new suffix", () => {
    const frames: string[] = [];
    let current = "/blog";
    while (current !== "/projects") {
      current = nextFrame(current, "/projects");
      frames.push(current);
    }
    expect(frames).toEqual([
      "/blo",
      "/bl",
      "/b",
      "/",
      "/p",
      "/pr",
      "/pro",
      "/proj",
      "/proje",
      "/projec",
      "/project",
      "/projects",
    ]);
  });

  it("deletes everything when going home", () => {
    expect(nextFrame("/b", "")).toBe("/");
    expect(nextFrame("/", "")).toBe("");
  });

  it("stays put once it has arrived", () => {
    expect(nextFrame("/blog", "/blog")).toBe("/blog");
  });
});
