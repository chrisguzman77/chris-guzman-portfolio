// @vitest-environment jsdom
import { expect, it, vi } from "vitest";

// The subscribe form is on the home page, and zod adds about 90 KB of JS there, which cost
// the mobile LCP. Nothing the newsletter client code imports may load it.
vi.mock("zod", () => {
  throw new Error("zod was loaded");
});

it("loads the newsletter client components without zod", async () => {
  await expect(import("./subscribe-form")).resolves.toHaveProperty("SubscribeForm");
  await expect(import("./newsletter-action")).resolves.toHaveProperty("NewsletterAction");
});
