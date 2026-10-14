import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import { DirectusUnavailableError, directusFiles, directusGet } from "./client";
import {
  getCertifications,
  getFaq,
  getChatSettings,
  getEducation,
  getExperience,
  getFileVersions,
  getInvolvement,
  getPost,
  getPosts,
  getProfile,
  getProject,
  getProjects,
  getResume,
  isReferencedFile,
} from "./queries";
import type { Experience, Post, Project } from "./schemas";

vi.mock("./client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./client")>()),
  directusGet: vi.fn(),
  directusFiles: vi.fn(),
}));

const get = vi.mocked(directusGet);
const files = vi.mocked(directusFiles);
const PUBLISHED = "filter[status][_eq]=published";
const FILE_ID = "123e4567-e89b-12d3-a456-426614174000";
const OTHER_ID = "0b5c3f0e-1111-4222-8333-444455556666";
const UPLOADED_ON = "2026-10-14T20:23:21.523Z";
const VERSION = "1792009401523";

function experience(overrides: Partial<Experience> = {}): Experience {
  return {
    id: 1,
    company: "ACM@AU",
    role: "Lead Developer",
    location: "Augusta, GA",
    start_date: "2026-01-01",
    end_date: null,
    highlights: [],
    tech: [],
    show_on_home: true,
    ...overrides,
  };
}

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 1,
    slug: "offres",
    title: "OFFRes / OFFPay",
    summary: "Offline payments.",
    body: null,
    type: "competition",
    award: null,
    tech: [],
    repo_url: null,
    live_url: null,
    cover: null,
    date: "2025-10-01",
    featured: true,
    ...overrides,
  };
}

function post(overrides: Partial<Post> = {}): Post {
  return {
    id: 1,
    slug: "hello",
    title: "Hello",
    published_at: "2026-10-14",
    excerpt: "Hi.",
    body: "Body",
    tags: [],
    cover: null,
    ...overrides,
  };
}

const profile = {
  name: "Christopher Guzman",
  intro: "Hi.",
  email: "chguzman@augusta.edu",
  location: "Augusta, GA",
  github_url: "https://github.com/chrisguzman77",
  linkedin_url: "https://www.linkedin.com/in/christopher-emmanuel-guzman/",
  seo_description: "Portfolio.",
};

let errorSpy: MockInstance<typeof console.error>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  get.mockReset();
  files.mockReset();
  errorSpy.mockRestore();
});

describe("list queries", () => {
  it("getExperience filters published, requests only schema fields, tags, and sorts", async () => {
    get.mockResolvedValue([
      experience({ id: 1, company: "SIEGE", start_date: "2025-06-01", end_date: "2026-06-01" }),
      experience({ id: 2, company: "CAHP", start_date: "2026-08-01", end_date: null }),
      experience({ id: 3, company: "Jubilee", start_date: "2026-03-01", end_date: null }),
    ]);
    const result = await getExperience();
    expect(result.map((e) => e.company)).toEqual(["CAHP", "Jubilee", "SIEGE"]);
    const [path, tags] = get.mock.calls[0];
    expect(path.startsWith("experience?")).toBe(true);
    expect(path).toContain(PUBLISHED);
    expect(path).toContain("limit=-1");
    expect(path).toContain(
      "fields=id,company,role,location,start_date,end_date,highlights,tech,show_on_home",
    );
    expect(tags).toEqual(["experience"]);
  });

  it("drops and logs invalid items", async () => {
    get.mockResolvedValue([experience(), { id: 9, company: 42 }]);
    const result = await getExperience();
    expect(result).toHaveLength(1);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("returns [] when Directus is unavailable", async () => {
    get.mockRejectedValue(new DirectusUnavailableError("down"));
    await expect(getExperience()).resolves.toEqual([]);
    await expect(getProjects()).resolves.toEqual([]);
    await expect(getPosts()).resolves.toEqual([]);
  });

  it("rethrows errors that are not DirectusUnavailableError", async () => {
    get.mockRejectedValue(new Error("prerender bailout"));
    await expect(getExperience()).rejects.toThrow("prerender bailout");
  });

  it("returns [] when Directus returns a non-list", async () => {
    get.mockResolvedValue({ unexpected: true });
    await expect(getEducation()).resolves.toEqual([]);
  });

  it.each([
    ["education", getEducation],
    ["involvement", getInvolvement],
    ["certifications", getCertifications],
    ["faq", getFaq],
  ] as const)("%s sorts by the manual sort field and filters published", async (name, query) => {
    get.mockResolvedValue([]);
    await query();
    const [path, tags] = get.mock.calls[0];
    expect(path.startsWith(`${name}?`)).toBe(true);
    expect(path).toContain(PUBLISHED);
    expect(path).toContain("sort=sort&");
    expect(tags).toEqual([name]);
  });

  it("getProjects sorts by sort then newest date", async () => {
    get.mockResolvedValue([project()]);
    await expect(getProjects()).resolves.toHaveLength(1);
    const [path, tags] = get.mock.calls[0];
    expect(path).toContain("sort=sort,-date");
    expect(path).toContain(PUBLISHED);
    expect(tags).toEqual(["projects", "files"]);
  });

  it("getProjects expands the cover to its id and upload time, tagged files for replacements", async () => {
    get.mockResolvedValue([{ ...project(), cover: { id: FILE_ID, uploaded_on: UPLOADED_ON } }]);
    const [item] = await getProjects();
    expect(item.cover).toEqual({ id: FILE_ID, version: VERSION });
    const [path] = get.mock.calls[0];
    expect(path.match(/fields=([^&]*)/)?.[1].split(",")).toEqual(
      expect.arrayContaining(["cover", "cover.id", "cover.uploaded_on", "title"]),
    );
  });

  it("getPosts sorts newest first", async () => {
    get.mockResolvedValue([post()]);
    await expect(getPosts()).resolves.toHaveLength(1);
    const [path, tags] = get.mock.calls[0];
    expect(path).toContain("sort=-published_at");
    expect(path).toContain(PUBLISHED);
    expect(tags).toEqual(["posts"]);
  });

  it("getPosts omits the markdown body from the list query and result", async () => {
    get.mockResolvedValue([post({ body: "Long body" })]);
    const [item] = await getPosts();
    const [path] = get.mock.calls[0];
    expect(path.match(/fields=([^&]*)/)?.[1].split(",")).not.toContain("body");
    expect(item).not.toHaveProperty("body");
  });
});

describe("detail queries", () => {
  it("getProject filters by encoded slug and published, tags collection and item", async () => {
    get.mockResolvedValue([project({ slug: "a b" })]);
    const result = await getProject("a b");
    expect(result?.slug).toBe("a b");
    const [path, tags] = get.mock.calls[0];
    expect(path).toContain(PUBLISHED);
    expect(path).toContain("filter[slug][_eq]=a%20b");
    expect(path).toContain("limit=1");
    expect(tags).toEqual(["projects", "projects:a b", "files"]);
  });

  it("getProject returns null when nothing matches or Directus is down", async () => {
    get.mockResolvedValueOnce([]);
    await expect(getProject("missing")).resolves.toBeNull();
    get.mockRejectedValueOnce(new DirectusUnavailableError("down"));
    await expect(getProject("offres")).resolves.toBeNull();
  });

  it("getProject returns null and logs when the item is invalid", async () => {
    get.mockResolvedValue([{ ...project(), type: "work" }]);
    await expect(getProject("offres")).resolves.toBeNull();
    expect(errorSpy).toHaveBeenCalled();
  });

  it("getPost filters published and tags posts and posts:<slug>", async () => {
    get.mockResolvedValue([post({ slug: "hello" })]);
    await expect(getPost("hello")).resolves.toMatchObject({ slug: "hello" });
    const [path, tags] = get.mock.calls[0];
    expect(path).toContain(PUBLISHED);
    expect(path).toContain("filter[slug][_eq]=hello");
    expect(tags).toEqual(["posts", "posts:hello"]);
  });
});

describe("singletons", () => {
  it("getProfile reads the singleton without a status filter", async () => {
    get.mockResolvedValue(profile);
    await expect(getProfile()).resolves.toEqual(profile);
    const [path, tags] = get.mock.calls[0];
    expect(path.startsWith("profile?fields=")).toBe(true);
    expect(path).not.toContain("filter[status]");
    expect(tags).toEqual(["profile"]);
  });

  it("getProfile returns null when invalid, empty, or unavailable", async () => {
    get.mockResolvedValueOnce({ ...profile, name: null });
    await expect(getProfile()).resolves.toBeNull();
    get.mockResolvedValueOnce(null);
    await expect(getProfile()).resolves.toBeNull();
    get.mockRejectedValueOnce(new DirectusUnavailableError("down"));
    await expect(getProfile()).resolves.toBeNull();
  });

  it("getProfile keeps the profile when only a link is malformed, nulling that link", async () => {
    get.mockResolvedValueOnce({ ...profile, github_url: "nope" });
    await expect(getProfile()).resolves.toMatchObject({ name: profile.name, github_url: null });
  });

  it("getResume parses the singleton with the file's version, tagged resume and files", async () => {
    get.mockResolvedValue({
      file: { id: FILE_ID, uploaded_on: UPLOADED_ON },
      version_label: "fall-2026",
      updated_at: "2026-10-01",
    });
    await expect(getResume()).resolves.toMatchObject({ file: { id: FILE_ID, version: VERSION } });
    expect(get).toHaveBeenCalledWith(
      "resume?fields=file,file.id,file.uploaded_on,version_label,updated_at",
      ["resume", "files"],
    );
  });

  it("getChatSettings parses the singleton and fetches only its fields", async () => {
    get.mockResolvedValueOnce({ enabled: false, suggested_questions: ["Q1", "Q2"] });
    await expect(getChatSettings()).resolves.toEqual({
      enabled: false,
      suggested_questions: ["Q1", "Q2"],
    });
    expect(get).toHaveBeenCalledWith("chat_settings?fields=enabled,suggested_questions", [
      "chat_settings",
    ]);
  });

  it("getChatSettings treats null fields as off/empty and falls back to null when Directus is down", async () => {
    get.mockResolvedValueOnce({ enabled: null, suggested_questions: null });
    await expect(getChatSettings()).resolves.toEqual({ enabled: false, suggested_questions: [] });
    get.mockRejectedValueOnce(new DirectusUnavailableError("down"));
    await expect(getChatSettings()).resolves.toBeNull();
  });
});

describe("isReferencedFile", () => {
  function serve(data: { resume?: unknown; projects?: unknown[]; posts?: unknown[] }) {
    get.mockImplementation(async (path: string) => {
      if (path.startsWith("resume")) return data.resume ?? null;
      if (path.startsWith("projects")) return data.projects ?? [];
      if (path.startsWith("posts")) return data.posts ?? [];
      return [];
    });
  }

  it("accepts the resume file", async () => {
    serve({
      resume: {
        file: { id: FILE_ID, uploaded_on: UPLOADED_ON },
        version_label: null,
        updated_at: null,
      },
    });
    await expect(isReferencedFile(FILE_ID)).resolves.toBe(true);
  });

  it("accepts a published project cover", async () => {
    serve({ projects: [{ ...project(), cover: { id: FILE_ID, uploaded_on: UPLOADED_ON } }] });
    await expect(isReferencedFile(FILE_ID)).resolves.toBe(true);
  });

  it("accepts a resume file or project cover Directus returns as a bare id", async () => {
    serve({ resume: { file: FILE_ID, version_label: null, updated_at: null } });
    await expect(isReferencedFile(FILE_ID)).resolves.toBe(true);
    serve({ projects: [{ ...project(), cover: OTHER_ID }] });
    await expect(isReferencedFile(OTHER_ID)).resolves.toBe(true);
  });

  it("accepts a published post cover", async () => {
    serve({ posts: [post({ cover: FILE_ID })] });
    await expect(isReferencedFile(FILE_ID)).resolves.toBe(true);
  });

  it("accepts a file linked from a published post body", async () => {
    serve({ posts: [post({ body: `![diagram](/assets/${FILE_ID})` })] });
    await expect(isReferencedFile(FILE_ID)).resolves.toBe(true);
  });

  it("accepts a file linked by absolute CMS URL in a project body", async () => {
    serve({
      projects: [project({ body: `![x](https://cms.christopherguzman.me/assets/${FILE_ID})` })],
    });
    await expect(isReferencedFile(FILE_ID)).resolves.toBe(true);
  });

  it("rejects an unreferenced file", async () => {
    serve({ projects: [project()], posts: [post()] });
    await expect(isReferencedFile(FILE_ID)).resolves.toBe(false);
  });

  it("only consults published projects and posts, never drafts", async () => {
    serve({});
    await isReferencedFile(FILE_ID);
    const paths = get.mock.calls.map(([path]) => path);
    const projectsPath = paths.find((p) => p.startsWith("projects"));
    const postsPath = paths.find((p) => p.startsWith("posts"));
    expect(projectsPath).toContain(PUBLISHED);
    expect(postsPath).toContain(PUBLISHED);
  });

  it("rejects everything when Directus is unavailable", async () => {
    get.mockRejectedValue(new DirectusUnavailableError("down"));
    await expect(isReferencedFile(FILE_ID)).resolves.toBe(false);
  });
});

describe("getFileVersions", () => {
  it("reads the upload time of every id in one cached query tagged files", async () => {
    files.mockResolvedValue([
      { id: FILE_ID, uploaded_on: UPLOADED_ON },
      { id: OTHER_ID, uploaded_on: "2026-10-10T08:00:00.000Z" },
    ]);
    await expect(getFileVersions([OTHER_ID, FILE_ID, OTHER_ID])).resolves.toEqual({
      [FILE_ID]: VERSION,
      [OTHER_ID]: String(Date.parse("2026-10-10T08:00:00.000Z")),
    });
    expect(files).toHaveBeenCalledTimes(1);
    // Sorted and de-duplicated, so the same set of ids always hits the same cache entry.
    expect(files).toHaveBeenCalledWith(
      `fields=id,uploaded_on&filter[id][_in]=${OTHER_ID},${FILE_ID}&limit=-1`,
      ["files"],
    );
  });

  it("does not call Directus when the body links no files", async () => {
    await expect(getFileVersions([])).resolves.toEqual({});
    expect(files).not.toHaveBeenCalled();
  });

  it("leaves out files it cannot read or that have no upload time", async () => {
    files.mockResolvedValue([{ id: FILE_ID, uploaded_on: null }]);
    await expect(getFileVersions([FILE_ID, OTHER_ID])).resolves.toEqual({});
  });

  it("returns {} when Directus is unavailable, so links fall back to unversioned URLs", async () => {
    files.mockRejectedValue(new DirectusUnavailableError("down"));
    await expect(getFileVersions([FILE_ID])).resolves.toEqual({});
  });
});
