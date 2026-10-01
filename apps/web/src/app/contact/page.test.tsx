// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getProfile } from "@/lib/directus/queries";
import type { Profile } from "@/lib/directus/schemas";

import ContactPage from "./page";

vi.mock("@/lib/directus/queries", () => ({ getProfile: vi.fn() }));

const profile: Profile = {
  name: "Christopher Guzman",
  intro: "Intro.",
  email: "chris@example.com",
  location: "Augusta, GA",
  github_url: "https://github.com/octochris",
  linkedin_url: "https://www.linkedin.com/in/chris-example/",
  seo_description: "SEO.",
};

afterEach(() => {
  cleanup();
  vi.mocked(getProfile).mockReset();
});

describe("/contact", () => {
  it("shows the prompt and title with no caption, form, or phone number", async () => {
    vi.mocked(getProfile).mockResolvedValue(profile);
    const { container } = render(await ContactPage());

    expect(screen.getByText("$ ping chris")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Get in touch" })).toBeTruthy();
    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector('a[href^="tel:"]')).toBeNull();
  });

  it("renders the email, LinkedIn, and GitHub cards from the profile", async () => {
    vi.mocked(getProfile).mockResolvedValue(profile);
    render(await ContactPage());

    expect(screen.getByRole("heading", { level: 2, name: "Email" })).toBeTruthy();
    expect(screen.getByText("chris@example.com")).toBeTruthy();
    expect(screen.getByText("chris-example")).toBeTruthy();
    expect(screen.getByText("@octochris")).toBeTruthy();

    const linkedin = screen.getByRole("link", { name: /open linkedin/i });
    expect(linkedin.getAttribute("href")).toBe("https://www.linkedin.com/in/chris-example/");
    expect(linkedin.getAttribute("target")).toBe("_blank");
    expect(linkedin.getAttribute("rel")).toBe("noopener noreferrer");

    const github = screen.getByRole("link", { name: /open github/i });
    expect(github.getAttribute("href")).toBe("https://github.com/octochris");
    expect(github.getAttribute("target")).toBe("_blank");
    expect(github.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("falls back to the site defaults when the profile is unavailable", async () => {
    vi.mocked(getProfile).mockResolvedValue(null);
    render(await ContactPage());

    expect(screen.getByText("chguzman@augusta.edu")).toBeTruthy();
    expect(screen.getByText("christopher-emmanuel-guzman")).toBeTruthy();
    expect(screen.getByText("@chrisguzman77")).toBeTruthy();
    expect(screen.getByRole("link", { name: /open github/i }).getAttribute("href")).toBe(
      "https://github.com/chrisguzman77",
    );
  });

  it("falls back to the site defaults when the schema nulled the profile URLs", async () => {
    vi.mocked(getProfile).mockResolvedValue({
      ...profile,
      github_url: null,
      linkedin_url: null,
    });
    render(await ContactPage());

    expect(screen.getByText("@chrisguzman77")).toBeTruthy();
    expect(screen.getByText("christopher-emmanuel-guzman")).toBeTruthy();
    expect(screen.getByRole("link", { name: /open github/i }).getAttribute("href")).toBe(
      "https://github.com/chrisguzman77",
    );
    expect(screen.getByRole("link", { name: /open linkedin/i }).getAttribute("href")).toBe(
      "https://www.linkedin.com/in/christopher-emmanuel-guzman/",
    );
  });

  it("treats an empty-string email like a missing one", async () => {
    vi.mocked(getProfile).mockResolvedValue({
      ...profile,
      email: "",
      github_url: null,
      linkedin_url: null,
    });
    render(await ContactPage());

    expect(screen.getByText("chguzman@augusta.edu")).toBeTruthy();
    expect(screen.getByRole("link", { name: /send email/i }).getAttribute("href")).toBe(
      "mailto:chguzman@augusta.edu",
    );
    expect(screen.getByText("@chrisguzman77")).toBeTruthy();
    expect(screen.getByText("christopher-emmanuel-guzman")).toBeTruthy();
  });

  it("offers the email action (mailto fallback in jsdom, which has no clipboard)", async () => {
    vi.mocked(getProfile).mockResolvedValue(profile);
    render(await ContactPage());

    expect(screen.getByRole("link", { name: /send email/i }).getAttribute("href")).toBe(
      "mailto:chris@example.com",
    );
  });
});
