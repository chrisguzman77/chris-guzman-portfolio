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

// Public proxy for CMS files. cms.christopherguzman.me stays behind Cloudflare Access, so the
// site serves only files that published content (or the resume singleton) points at.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return new Response("Bad request", { status: 400 });
  if (!(await isReferencedFile(id))) return new Response("Not found", { status: 404 });

  const { directusUrl, directusToken } = serverEnv();
  let upstream: Response;
  try {
    upstream = await fetch(`${directusUrl}/assets/${id}`, {
      headers: { Authorization: `Bearer ${directusToken}` },
      cache: "no-store",
    });
  } catch {
    return new Response("Bad gateway", { status: 502 });
  }
  if (!upstream.ok || !upstream.body) return new Response("Bad gateway", { status: 502 });

  const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  };
  // Anything that could execute as active content (HTML, SVG, ...) must not run on the site origin.
  if (!INLINE_SAFE.has(contentType.split(";")[0].trim().toLowerCase())) {
    headers["Content-Security-Policy"] = "default-src 'none'; sandbox";
    headers["Content-Disposition"] = "attachment";
  }
  return new Response(upstream.body, { headers });
}
