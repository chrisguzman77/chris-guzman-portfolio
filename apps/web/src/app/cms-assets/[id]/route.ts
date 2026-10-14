import { ASSET_VERSION } from "@/lib/cms-assets";
import { isReferencedFile } from "@/lib/directus/queries";
import { serverEnv } from "@/lib/env";

const INLINE_SAFE = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/avif",
  "image/gif",
  "application/pdf",
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The only resized variants anyone can ask for (?w=), so nobody can make Directus generate and
// store arbitrary sizes. Markdown images ask for 1200.
const WIDTHS = new Set(["1200"]);

// Directus 12.4.1 asset transform query keys (ASSET_TRANSFORM_QUERY_KEYS in @directus/api).
// Directus serves types it can't transform (SVG, GIF, PDF) as the original.
function transformQuery(width: string): string {
  return `width=${width}&fit=inside&withoutEnlargement=true&format=webp&quality=80`;
}

// The query may hold at most one allowed ?w= and one ?v= (the file version, see cmsAssetUrl), in
// any order. v is only a cache key: it is validated, then never sent to Directus.
// Undefined when there is no width, null when the query has anything else.
function requestedWidth(request: Request): string | undefined | null {
  const params = [...new URL(request.url).searchParams];
  const width = params.filter(([key]) => key === "w");
  const version = params.filter(([key]) => key === "v");
  if (width.length + version.length !== params.length) return null;
  if (width.length > 1 || version.length > 1) return null;
  if (version.length === 1 && !ASSET_VERSION.test(version[0][1])) return null;
  if (width.length === 0) return undefined;
  return WIDTHS.has(width[0][1]) ? width[0][1] : null;
}

async function fetchAsset(url: string, token: string | undefined): Promise<Response | null> {
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (res.ok && res.body) return res;
    await res.body?.cancel();
  } catch {}
  return null;
}

// Public proxy for CMS files. cms.christopherguzman.me stays behind Cloudflare Access, so the
// site serves only files that published content (or the resume singleton) points at.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return new Response("Bad request", { status: 400 });
  const width = requestedWidth(request);
  if (width === null) return new Response("Bad request", { status: 400 });
  if (!(await isReferencedFile(id))) return new Response("Not found", { status: 404 });

  const { directusUrl, directusToken } = serverEnv();
  const original = `${directusUrl}/assets/${id}`;
  // A failed transform falls back to the original, so a resize problem never breaks an image.
  const resized = width
    ? await fetchAsset(`${original}?${transformQuery(width)}`, directusToken)
    : null;
  const upstream = resized || (await fetchAsset(original, directusToken));
  if (!upstream) return new Response("Bad gateway", { status: 502 });
  // A fallback for a ?w= request is cached briefly, so a transient failure is retried, not pinned.
  const fellBack = Boolean(width) && !resized;

  const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Cache-Control": fellBack ? "public, max-age=300" : "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  };
  // Anything that could execute as active content (HTML, SVG, ...) must not run on the site origin.
  if (!INLINE_SAFE.has(contentType.split(";")[0].trim().toLowerCase())) {
    headers["Content-Security-Policy"] = "default-src 'none'; sandbox";
    headers["Content-Disposition"] = "attachment";
  }
  return new Response(upstream.body, { headers });
}
