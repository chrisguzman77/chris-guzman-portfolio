import type { Metadata } from "next";
import { describe, expect, it, vi } from "vitest";

import { rootOgImage } from "@/lib/metadata";

import { metadata as blog } from "./blog/page";
import { metadata as contact } from "./contact/page";
import { metadata as education } from "./education/page";
import { metadata as experience } from "./experience/page";
import { metadata as home } from "./page";
import { metadata as projects } from "./projects/page";
import { metadata as resume } from "./resume/page";

vi.mock("@/lib/directus/queries", () => ({}));

describe("static page metadata", () => {
  it.each([
    ["blog", blog],
    ["contact", contact],
    ["education", education],
    ["experience", experience],
    ["projects", projects],
    ["resume", resume],
  ])("%s has a description", (_name, metadata) => {
    expect(typeof metadata.description).toBe("string");
    expect((metadata.description ?? "").length).toBeGreaterThan(20);
  });

  it.each<[string, Metadata, string]>([
    ["/blog", blog, "Blog"],
    ["/contact", contact, "Contact"],
    ["/education", education, "Education"],
    ["/experience", experience, "Experience"],
    ["/projects", projects, "Projects"],
    ["/resume", resume, "Resume"],
  ])("%s mirrors its title and description into Open Graph", (path, metadata, title) => {
    expect(metadata.title).toBe(title);
    expect(metadata.openGraph).toMatchObject({
      title,
      description: metadata.description,
      url: path,
      images: [rootOgImage],
    });
  });

  it("home keeps the site title and description, with its own URL and the root image", () => {
    expect(home.title).toEqual({ absolute: "Christopher Guzman" });
    expect(home.openGraph).toMatchObject({
      title: "Christopher Guzman",
      description: home.description,
      url: "/",
      images: [rootOgImage],
    });
  });
});
