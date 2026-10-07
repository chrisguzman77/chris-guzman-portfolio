import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";

import { askQuestion, createSession } from "@/lib/chat";
import { ActivitySchema } from "@/lib/github-activity";
import { SiteStatusSchema } from "@/lib/status";

import {
  CertificationSchema,
  ChatSettingsSchema,
  EducationSchema,
  ExperienceSchema,
  InvolvementSchema,
  PostSchema,
  ProfileSchema,
  ProjectSchema,
  ResumeSchema,
} from "./schemas";

// The Playwright fake backend serves these files; parse them with the real schemas so fixture
// drift fails here instead of as a confusing empty page in e2e.
const root = path.resolve(__dirname, "../../../e2e/fixtures");

function load(kind: "directus" | "api", name: string): unknown {
  return JSON.parse(readFileSync(path.join(root, kind, `${name}.json`), "utf8"));
}

const LISTS: [string, z.ZodType][] = [
  ["projects", ProjectSchema],
  ["posts", PostSchema],
  ["experience", ExperienceSchema],
  ["education", EducationSchema],
  ["involvement", InvolvementSchema],
  ["certifications", CertificationSchema],
];

describe("e2e Directus fixtures", () => {
  it.each(LISTS)("%s parses item by item", (name, schema) => {
    const items = load("directus", name);
    expect(Array.isArray(items)).toBe(true);
    for (const item of items as unknown[]) expect(() => schema.parse(item)).not.toThrow();
  });

  it("projects cover the journey: this-portfolio, a featured one, at least 3", () => {
    const projects = (load("directus", "projects") as unknown[]).map((p) => ProjectSchema.parse(p));
    expect(projects.length).toBeGreaterThanOrEqual(3);
    expect(projects.some((p) => p.slug === "this-portfolio")).toBe(true);
    expect(projects.some((p) => p.featured)).toBe(true);
    expect(new Set(projects.map((p) => p.id)).size).toBe(projects.length);
  });

  it("singletons parse, resume has a file, chat is enabled", () => {
    ProfileSchema.parse(load("directus", "profile"));
    expect(ResumeSchema.parse(load("directus", "resume")).file).toMatch(/^[0-9a-f-]{36}$/);
    expect(ChatSettingsSchema.parse(load("directus", "chat_settings")).enabled).toBe(true);
    expect((load("directus", "posts") as unknown[]).length).toBeGreaterThanOrEqual(1);
  });
});

describe("e2e API fixtures", () => {
  afterEach(() => vi.unstubAllGlobals());

  function respond(status: number, body: unknown) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(body), { status })),
    );
  }

  it("status is operational with 30 days, the last at 1", () => {
    const status = SiteStatusSchema.parse(load("api", "status"));
    expect(status.status).toBe("operational");
    expect(status.daily.at(-1)?.uptime).toBe(1);
  });

  it("github activity parses", () => {
    expect(() => ActivitySchema.parse(load("api", "github-activity"))).not.toThrow();
  });

  it("chat session and message parse with the real client", async () => {
    respond(201, load("api", "chat-session"));
    expect(await createSession("http://api", "t")).toEqual({
      kind: "ok",
      sessionId: "s1",
      questionsLeft: 10,
    });
    respond(200, load("api", "chat-message"));
    const answer = await askQuestion("http://api", "s1", "q");
    expect(answer.kind).toBe("answer");
  });
});
