import { connection } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UmamiScript } from "./umami-script";

vi.mock("next/server", () => ({ connection: vi.fn(async () => undefined) }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(connection).mockClear();
});

describe("UmamiScript", () => {
  it("renders nothing when UMAMI_WEBSITE_ID is unset, and reads it at request time", async () => {
    vi.stubEnv("UMAMI_WEBSITE_ID", "");
    await expect(UmamiScript()).resolves.toBeNull();
    expect(connection).toHaveBeenCalled();
  });

  it("renders the proxied tracker when UMAMI_WEBSITE_ID is set", async () => {
    vi.stubEnv("UMAMI_WEBSITE_ID", "6b1f0c2e-1d2a-4c3b-9e8f-0a1b2c3d4e5f");
    const element = await UmamiScript();
    expect(renderToStaticMarkup(element!)).toBe(
      '<script defer="" src="/stats/script.js" data-website-id="6b1f0c2e-1d2a-4c3b-9e8f-0a1b2c3d4e5f" data-host-url="/stats"></script>',
    );
  });
});
