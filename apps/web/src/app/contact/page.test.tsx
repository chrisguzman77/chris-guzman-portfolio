// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getProfile } from "@/lib/directus/queries";
import type { Profile } from "@/lib/directus/schemas";

import ContactPage from "./page";

vi.mock("@/lib/directus/queries", () => ({ getProfile: vi.fn() }));
vi.mock("@/components/contact/contact-form", () => ({
  ContactForm: (props: { apiUrl: string; siteKey: string; fallbackEmail: string }) => (
    <div data-testid="contact-form">{JSON.stringify(props)}</div>
  ),
}));

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
  vi.unstubAllEnvs();
});

describe("/contact", () => {
  it("shows the prompt and title with no caption or phone number", async () => {
    vi.mocked(getProfile).mockResolvedValue(profile);
    const { container } = render(await ContactPage());

    expect(screen.getByText("$ ping chris")).toBeTruthy();
    const title = screen.getByRole("heading", { level: 1, name: "Get in touch" });
    // The header block is exactly the prompt line and the h1: no caption paragraph beneath it.
    expect(title.parentElement?.children).toHaveLength(2);
    expect(title.nextElementSibling).toBeNull();
    expect(container.querySelector('a[href^="tel:"]')).toBeNull();
    expect(container.textContent).not.toMatch(/\+?\d[\d\s().-]{8,}\d/);
  });

  it("renders the form with the site key, public API URL and profile email", async () => {
    vi.stubEnv("TURNSTILE_SITE_KEY", "site-key");
    vi.stubEnv("PUBLIC_API_URL", "https://api.example.com");
    vi.mocked(getProfile).mockResolvedValue(profile);
    render(await ContactPage());

    expect(screen.getByRole("heading", { level: 2, name: "Send a message" })).toBeTruthy();
    expect(JSON.parse(screen.getByTestId("contact-form").textContent ?? "")).toEqual({
      apiUrl: "https://api.example.com",
      siteKey: "site-key",
      fallbackEmail: "chris@example.com",
    });
  });

  it("says the form is coming soon when Turnstile is not configured", async () => {
    vi.stubEnv("TURNSTILE_SITE_KEY", "");
    vi.mocked(getProfile).mockResolvedValue(profile);
    render(await ContactPage());

    expect(screen.queryByTestId("contact-form")).toBeNull();
    expect(screen.getByText("Contact form coming soon. Email me directly.")).toBeTruthy();
  });

  it("lists email, LinkedIn and GitHub as compact rows under a hidden heading", async () => {
    vi.mocked(getProfile).mockResolvedValue(profile);
    render(await ContactPage());

    expect(
      screen.getByRole("heading", { level: 2, name: "Other ways to reach me" }).className,
    ).toContain("sr-only");
    for (const name of ["Email", "LinkedIn", "GitHub"]) {
      expect(screen.getByRole("heading", { level: 3, name })).toBeTruthy();
    }
  });

  it("renders the email, LinkedIn, and GitHub rows from the profile", async () => {
    vi.mocked(getProfile).mockResolvedValue(profile);
    render(await ContactPage());

    expect(screen.getByRole("heading", { level: 3, name: "Email" })).toBeTruthy();
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

  it("tags the LinkedIn and GitHub open buttons as outbound clicks", async () => {
    vi.mocked(getProfile).mockResolvedValue(profile);
    render(await ContactPage());
    const linkedin = screen.getByRole("link", { name: "Open LinkedIn profile" });
    const github = screen.getByRole("link", { name: "Open GitHub profile" });
    expect(linkedin.getAttribute("data-umami-event")).toBe("outbound-click");
    expect(linkedin.getAttribute("data-umami-event-to")).toBe("linkedin");
    expect(github.getAttribute("data-umami-event")).toBe("outbound-click");
    expect(github.getAttribute("data-umami-event-to")).toBe("github");
  });
});
