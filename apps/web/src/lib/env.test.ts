import { afterEach, describe, expect, it, vi } from "vitest";

import { serverEnv } from "./env";

afterEach(() => vi.unstubAllEnvs());

describe("serverEnv", () => {
  it("reads every variable and strips trailing slashes from URLs", () => {
    vi.stubEnv("DIRECTUS_URL", "http://directus:8055/");
    vi.stubEnv("DIRECTUS_TOKEN", "tok");
    vi.stubEnv("API_INTERNAL_URL", "http://api:8000/");
    vi.stubEnv("REVALIDATE_SECRET", "s3cret");
    vi.stubEnv("SITE_URL", "https://example.test/");
    vi.stubEnv("TURNSTILE_SITE_KEY", "site-key");
    vi.stubEnv("PUBLIC_API_URL", "http://localhost:8000/");
    expect(serverEnv()).toEqual({
      directusUrl: "http://directus:8055",
      directusToken: "tok",
      apiInternalUrl: "http://api:8000",
      revalidateSecret: "s3cret",
      siteUrl: "https://example.test",
      turnstileSiteKey: "site-key",
      publicApiUrl: "http://localhost:8000",
    });
  });

  it("treats empty values as unset and defaults SITE_URL", () => {
    for (const name of [
      "DIRECTUS_URL",
      "DIRECTUS_TOKEN",
      "API_INTERNAL_URL",
      "REVALIDATE_SECRET",
      "SITE_URL",
      "TURNSTILE_SITE_KEY",
      "PUBLIC_API_URL",
    ]) {
      vi.stubEnv(name, "");
    }
    expect(serverEnv()).toEqual({
      directusUrl: undefined,
      directusToken: undefined,
      apiInternalUrl: undefined,
      revalidateSecret: undefined,
      siteUrl: "https://christopherguzman.me",
      turnstileSiteKey: undefined,
      publicApiUrl: "https://api.christopherguzman.me",
    });
  });

  it("reads process.env on every call", () => {
    vi.stubEnv("DIRECTUS_URL", "http://one");
    expect(serverEnv().directusUrl).toBe("http://one");
    vi.stubEnv("DIRECTUS_URL", "http://two");
    expect(serverEnv().directusUrl).toBe("http://two");
  });
});
