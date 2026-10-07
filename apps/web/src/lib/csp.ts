// Enforced CSP. Scripts need this request's nonce; 'strict-dynamic' lets nonced scripts load
// others (Turnstile), and makes browsers ignore 'self' and host sources for scripts.
// style-src keeps 'unsafe-inline' because Next and next-themes set style attributes (see
// docs/security.md).
export function buildCsp({
  nonce,
  apiOrigin,
  dev,
  upgradeInsecure,
}: {
  nonce: string;
  apiOrigin: string;
  dev: boolean;
  upgradeInsecure: boolean;
}): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://challenges.cloudflare.com${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' ${apiOrigin} https://challenges.cloudflare.com`,
    "frame-src https://challenges.cloudflare.com",
    "object-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (upgradeInsecure) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}
