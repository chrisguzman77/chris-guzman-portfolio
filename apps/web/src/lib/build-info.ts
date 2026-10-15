import { formatAgo } from "@/lib/status";

const REPO = "https://github.com/chrisguzman77/chris-guzman-portfolio";

export type BuildEnv = { version?: string; release?: string; builtAt?: string };

export type BuildInfo = {
  sha: string;
  shaUrl: string;
  release: string | null;
  releaseUrl: string | null;
  builtAt: string;
  ago: string;
};

// The footer's "deployed 2h ago · cf6681f · v1.0.0". Null when the build wasn't stamped by
// release.yml (local dev, the CI image check), which the footer shows as "dev".
export function buildInfo(env: BuildEnv, now: number = Date.now()): BuildInfo | null {
  const { version, release, builtAt } = env;
  if (!version || version === "dev" || !builtAt || Number.isNaN(Date.parse(builtAt))) {
    return null;
  }
  return {
    sha: version.slice(0, 7),
    shaUrl: `${REPO}/commit/${version}`,
    release: release || null,
    releaseUrl: release ? `${REPO}/releases/tag/${release}` : null,
    builtAt,
    ago: formatAgo(builtAt, now),
  };
}
