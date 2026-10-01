export type ServerEnv = {
  directusUrl: string | undefined;
  directusToken: string | undefined;
  apiInternalUrl: string | undefined;
  revalidateSecret: string | undefined;
  siteUrl: string;
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
  };
}
