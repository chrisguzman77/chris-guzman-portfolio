import { isReferencedFile } from "@/lib/directus/queries";
import { serverEnv } from "@/lib/env";

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

  return new Response(upstream.body, {
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
