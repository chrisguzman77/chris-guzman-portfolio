// /cms-assets is served with a 1-year immutable cache, and Directus "Replace file" keeps the file
// id. So every link carries ?v=<version>: the file's uploaded_on in epoch ms, which Directus 12.4.1
// sets on every upload, replacements included (metadata edits leave it alone).
export const ASSET_VERSION = /^\d{1,13}$/;

export function fileVersion(uploadedOn: string | null | undefined): string | null {
  const ms = uploadedOn ? Date.parse(uploadedOn) : NaN;
  const version = String(ms);
  return ASSET_VERSION.test(version) ? version : null;
}

// Without a known version the link is unversioned: it still works, but browsers and Cloudflare
// keep whatever copy they cached before a replacement.
export function cmsAssetUrl(
  id: string,
  version: string | null | undefined,
  width?: "1200",
): string {
  const query = [width && `w=${width}`, version && `v=${version}`].filter(Boolean).join("&");
  return `/cms-assets/${id}${query ? `?${query}` : ""}`;
}
