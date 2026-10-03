// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getExperience, getPosts, getProfile, getProjects } from "@/lib/directus/queries";
import type { Experience, Post, Profile, Project } from "@/lib/directus/schemas";
import { getGithubActivity } from "@/lib/github-activity";
import { siteConfig } from "@/lib/site";

import HomePage from "./page";

vi.mock("@/lib/directus/queries", () => ({
  getProfile: vi.fn(),
  getProjects: vi.fn(),
  getExperience: vi.fn(),
  getPosts: vi.fn(),
}));

vi.mock("@/lib/github-activity", () => ({ getGithubActivity: vi.fn() }));

vi.mock("@/components/content/status-card", () => ({
  StatusCard: () => <p>status card stub</p>,
  StatusCardSkeleton: () => <p>checking</p>,
}));

const profile: Profile = {
  name: "Chris From Profile",
  intro: "I build secure, data-driven systems and lead our ACM chapter platform.",
  email: "chguzman@augusta.edu",
  location: "Augusta, GA",
  github_url: "https://github.com/profile-gh",
  linkedin_url: "https://www.linkedin.com/in/profile-li/",
  seo_description: "Portfolio.",
};

function project(over: Partial<Project> & Pick<Project, "id" | "slug" | "title">): Project {
  return {
    summary: `${over.title} summary`,
    body: null,
    type: "personal",
    award: null,
    tech: ["next.js"],
    repo_url: null,
    live_url: null,
    cover: null,
    date: "2026-01-01",
    featured: false,
    ...over,
  };
}

function role(over: Partial<Experience> & Pick<Experience, "id" | "company">): Experience {
  return {
    role: "Engineer",
    location: "Augusta, GA",
    start_date: "2026-01-01",
    end_date: null,
    highlights: ["Did a thing."],
    tech: ["python"],
    show_on_home: true,
    ...over,
  };
}

function post(over: Partial<Post> & Pick<Post, "id" | "slug" | "title">): Post {
  return {
    published_at: "2026-10-14",
    excerpt: `${over.title} excerpt`,
    body: "## Hello",
    tags: [],
    cover: null,
    ...over,
  };
}

const projects: Project[] = [
  project({ id: 1, slug: "alpha", title: "Alpha Project", featured: true }),
  project({ id: 2, slug: "bravo", title: "Bravo Project", featured: true }),
  project({ id: 3, slug: "not-featured", title: "Hidden Project", featured: false }),
  project({ id: 4, slug: "charlie", title: "Charlie Project", featured: true }),
  project({ id: 5, slug: "delta", title: "Delta Project", featured: true }),
];

const experience: Experience[] = [
  role({ id: 1, company: "Acme Labs" }),
  role({ id: 2, company: "Off Home Corp", show_on_home: false }),
  role({ id: 3, company: "Globex", end_date: "2026-07-01" }),
];

const activity = {
  total: 42,
  weeks: [{ days: [{ date: "2026-09-14", count: 3, level: 4 }] }],
  fetched_at: "2026-10-02T12:00:00Z",
};

const posts: Post[] = [
  post({ id: 1, slug: "p1", title: "Post One" }),
  post({ id: 2, slug: "p2", title: "Post Two" }),
  post({ id: 3, slug: "p3", title: "Post Three" }),
  post({ id: 4, slug: "p4", title: "Post Four" }),
];

/** Whitespace-stripped text of every h2 that starts with a two-digit section number. */
function numberedHeadings(): string[] {
  return screen
    .queryAllByRole("heading", { level: 2 })
    .map((h) => (h.textContent ?? "").replace(/\s+/g, ""))
    .filter((t) => /^\d{2}/.test(t));
}

function classes(el: Element): string[] {
  return el.className.split(/\s+/);
}

beforeEach(() => {
  vi.mocked(getProfile).mockResolvedValue(profile);
  vi.mocked(getProjects).mockResolvedValue(projects);
  vi.mocked(getExperience).mockResolvedValue(experience);
  vi.mocked(getPosts).mockResolvedValue(posts);
  vi.mocked(getGithubActivity).mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("HomePage hero", () => {
  it("renders the prompt, name, intro, both action rows, and the status card", async () => {
    render(await HomePage());

    expect(screen.getByText("$ whoami")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Chris From Profile" })).toBeTruthy();
    expect(screen.getByText(profile.intro)).toBeTruthy();
    // scripts/smoke.sh greps for this marker to prove profile content came from the CMS.
    expect(screen.getByText(profile.intro).getAttribute("data-cms")).toBe("profile-intro");
    expect(screen.getByText("status card stub")).toBeTruthy();

    expect(screen.getByRole("link", { name: "Download resume" }).getAttribute("href")).toBe(
      "/resume",
    );
    expect(screen.getByRole("link", { name: "Get in touch" }).getAttribute("href")).toBe(
      "/contact",
    );

    const github = screen.getByRole("link", { name: "GitHub" });
    expect(github.getAttribute("href")).toBe(profile.github_url);
    expect(github.getAttribute("target")).toBe("_blank");
    expect(github.getAttribute("rel")).toBe("noopener noreferrer");

    const linkedin = screen.getByRole("link", { name: "LinkedIn" });
    expect(linkedin.getAttribute("href")).toBe(profile.linkedin_url);
    expect(linkedin.getAttribute("target")).toBe("_blank");
    expect(linkedin.getAttribute("rel")).toBe("noopener noreferrer");

    const photo = screen.getByAltText("Portrait of Christopher Guzman");
    expect(photo.getAttribute("src")).toContain("chris.jpg");
  });

  it("falls back to siteConfig when the profile is unavailable and omits the intro", async () => {
    vi.mocked(getProfile).mockResolvedValue(null);
    render(await HomePage());

    expect(screen.getByRole("heading", { level: 1, name: siteConfig.name })).toBeTruthy();
    expect(screen.queryByText(profile.intro)).toBeNull();
    expect(document.querySelector('[data-cms="profile-intro"]')).toBeNull();
    expect(screen.getByRole("link", { name: "GitHub" }).getAttribute("href")).toBe(
      siteConfig.links.github,
    );
    expect(screen.getByRole("link", { name: "LinkedIn" }).getAttribute("href")).toBe(
      siteConfig.links.linkedin,
    );
  });

  it("orders name, photo, intro on narrow screens and becomes two columns on md", async () => {
    render(await HomePage());

    const nameBlock = screen.getByRole("heading", { level: 1 }).parentElement!;
    const textColumn = nameBlock.parentElement!;
    const grid = textColumn.parentElement!;
    const photo = screen.getByAltText("Portrait of Christopher Guzman");
    const introBlock = screen.getByText(profile.intro).parentElement!;

    expect(classes(grid)).toEqual(expect.arrayContaining(["grid", "md:grid-cols-[1.35fr_1fr]"]));
    // Narrow: the text column dissolves so its children become grid items ordered around the photo.
    expect(classes(textColumn)).toEqual(expect.arrayContaining(["contents", "md:block"]));
    expect(classes(nameBlock)).toContain("order-1");
    expect(photo.parentElement).toBe(grid);
    expect(classes(photo)).toEqual(expect.arrayContaining(["order-2", "w-full", "max-w-[300px]"]));
    expect(introBlock.parentElement).toBe(textColumn);
    expect(classes(introBlock)).toContain("order-3");
  });

  it("orders intro, resume and contact buttons, GitHub and LinkedIn, then the status card", async () => {
    render(await HomePage());

    const order = [
      screen.getByText(profile.intro),
      screen.getByRole("link", { name: "Download resume" }),
      screen.getByRole("link", { name: "Get in touch" }),
      screen.getByRole("link", { name: "GitHub" }),
      screen.getByRole("link", { name: "LinkedIn" }),
      screen.getByText("status card stub"),
    ];
    for (let i = 1; i < order.length; i++) {
      expect(
        order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    }
    // The card sits in the same text column as the intro.
    expect(screen.getByText("status card stub").closest(".order-3")).toBe(
      screen.getByText(profile.intro).parentElement,
    );
  });
});

describe("HomePage sections", () => {
  it("shows up to three featured projects, home roles, and the latest three posts as 01/02/03", async () => {
    render(await HomePage());

    expect(numberedHeadings()).toEqual([
      expect.stringMatching(/^01Featuredprojects/),
      expect.stringMatching(/^02Experience/),
      expect.stringMatching(/^03Blog/),
    ]);

    expect(screen.getByRole("link", { name: /Alpha Project/ }).getAttribute("href")).toBe(
      "/projects/alpha",
    );
    expect(screen.getByText("Bravo Project")).toBeTruthy();
    expect(screen.getByText("Charlie Project")).toBeTruthy();
    expect(screen.queryByText("Delta Project")).toBeNull();
    expect(screen.queryByText("Hidden Project")).toBeNull();
    expect(screen.getByRole("link", { name: /all projects/ }).getAttribute("href")).toBe(
      "/projects",
    );

    expect(screen.getByText("Acme Labs")).toBeTruthy();
    expect(screen.getByText("Globex")).toBeTruthy();
    expect(screen.queryByText("Off Home Corp")).toBeNull();
    expect(screen.getByRole("link", { name: /full history/ }).getAttribute("href")).toBe(
      "/experience",
    );

    expect(screen.getByText("Post One")).toBeTruthy();
    expect(screen.getByText("Post Three")).toBeTruthy();
    expect(screen.queryByText("Post Four")).toBeNull();
    expect(screen.getByRole("link", { name: /all posts/ }).getAttribute("href")).toBe("/blog");
  });

  it("leaves vertical spacing of home experience rows to ExperienceEntry", async () => {
    render(await HomePage());

    const item = screen.getByText("Acme Labs").closest("li")!;
    expect(classes(item)).not.toContain("py-2.5");
    expect(item.querySelector("article")!.className).toContain("py-4");
  });

  it("does not render the Blog section at all when there are no posts", async () => {
    vi.mocked(getPosts).mockResolvedValue([]);
    render(await HomePage());

    expect(numberedHeadings()).toEqual([
      expect.stringMatching(/^01Featuredprojects/),
      expect.stringMatching(/^02Experience/),
    ]);
    expect(screen.queryByRole("link", { name: /all posts/ })).toBeNull();
  });

  it("hides Featured projects when none are featured and renumbers the rest", async () => {
    vi.mocked(getProjects).mockResolvedValue([
      project({ id: 9, slug: "plain", title: "Plain Project", featured: false }),
    ]);
    render(await HomePage());

    expect(numberedHeadings()).toEqual([
      expect.stringMatching(/^01Experience/),
      expect.stringMatching(/^02Blog/),
    ]);
    expect(screen.queryByRole("link", { name: /all projects/ })).toBeNull();
  });
});

describe("HomePage GitHub activity", () => {
  it("shows GitHub activity after Experience and numbers it", async () => {
    vi.mocked(getGithubActivity).mockResolvedValue(activity);
    vi.mocked(getPosts).mockResolvedValue([]);
    render(await HomePage());

    expect(numberedHeadings()).toEqual([
      expect.stringMatching(/^01Featuredprojects/),
      expect.stringMatching(/^02Experience/),
      expect.stringMatching(/^03GitHubactivity/),
    ]);
    const handle = screen.getByRole("link", { name: "@profile-gh" });
    expect(handle.getAttribute("href")).toBe("https://github.com/profile-gh");
    expect(handle.getAttribute("target")).toBe("_blank");
    expect(handle.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("hides the section and keeps Blog as 03 when activity is unavailable", async () => {
    render(await HomePage());

    const headings = numberedHeadings();
    expect(headings.some((h) => h.includes("GitHubactivity"))).toBe(false);
    expect(headings.at(-1)).toMatch(/^03Blog/);
  });

  it("numbers Blog 04 when activity is shown", async () => {
    vi.mocked(getGithubActivity).mockResolvedValue(activity);
    render(await HomePage());

    expect(numberedHeadings().at(-1)).toMatch(/^04Blog/);
  });
});
