import { connection } from "next/server";

import { serverEnv } from "@/lib/env";

export class DirectusUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DirectusUnavailableError";
  }
}

const ONE_DAY = 86400;

// Request-time only: connection() keeps `next build` from ever calling Directus.
async function get(path: string, tags: string[]): Promise<unknown> {
  await connection();
  const { directusUrl, directusToken } = serverEnv();
  if (!directusUrl || !directusToken) {
    throw new DirectusUnavailableError("DIRECTUS_URL or DIRECTUS_TOKEN is not set");
  }

  let res: Response;
  try {
    res = await fetch(`${directusUrl}/${path}`, {
      headers: { Authorization: `Bearer ${directusToken}` },
      cache: "force-cache",
      next: { tags, revalidate: ONE_DAY },
    });
  } catch (error) {
    throw new DirectusUnavailableError(`Directus request failed for ${path}: ${String(error)}`);
  }
  if (!res.ok) {
    throw new DirectusUnavailableError(`Directus returned ${res.status} for ${path}`);
  }
  try {
    const body = (await res.json()) as { data?: unknown };
    return body.data ?? null;
  } catch (error) {
    throw new DirectusUnavailableError(`Directus returned invalid JSON for ${path}`, {
      cause: error,
    });
  }
}

export function directusGet(path: string, tags: string[]): Promise<unknown> {
  return get(`items/${path}`, tags);
}

// directus_files is a system collection, which /items does not serve.
export function directusFiles(query: string, tags: string[]): Promise<unknown> {
  return get(`files?${query}`, tags);
}
