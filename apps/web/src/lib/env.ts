export type ServerEnv = {
  directusUrl: string | undefined;
  directusToken: string | undefined;
  apiInternalUrl: string | undefined;
  revalidateSecret: string | undefined;
  siteUrl: string;
  turnstileSiteKey: string | undefined;
  publicApiUrl: string;
  umamiWebsiteId: string | undefined;
  internalApiSecret: string | undefined;
  cfAccessTeamDomain: string | undefined;
  cfAccessAud: string | undefined;
};

function read(name: string): string | undefined {
  const value = process.env[name];
  return value ? value : undefined;
}

function readUrl(name: string): string | undefined {
  return read(name)?.replace(/\/+$/, "");
}

// Reads process.env on every call so tests and runtime config changes are always seen.
export function serverEnv(): ServerEnv {
  return {
    directusUrl: readUrl("DIRECTUS_URL"),
    directusToken: read("DIRECTUS_TOKEN"),
    apiInternalUrl: readUrl("API_INTERNAL_URL"),
    revalidateSecret: read("REVALIDATE_SECRET"),
    siteUrl: readUrl("SITE_URL") ?? "https://christopherguzman.me",
    turnstileSiteKey: read("TURNSTILE_SITE_KEY"),
    publicApiUrl: readUrl("PUBLIC_API_URL") ?? "https://api.christopherguzman.me",
    umamiWebsiteId: read("UMAMI_WEBSITE_ID"),
    internalApiSecret: read("INTERNAL_API_SECRET"),
    cfAccessTeamDomain: read("CF_ACCESS_TEAM_DOMAIN"),
    cfAccessAud: read("CF_ACCESS_AUD"),
  };
}
