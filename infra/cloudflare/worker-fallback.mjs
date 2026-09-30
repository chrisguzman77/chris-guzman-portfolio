// Cloudflare Worker routed on christopherguzman.me/* and www.christopherguzman.me/*.
// Redirects www to the apex, passes every other request to the origin (the
// tunnel), and replaces "origin unreachable" responses with a branded page so a
// home-internet or VM outage reads as planned maintenance, not a broken site.
const APEX = "christopherguzman.me";

// 502-504 from cloudflared, 52x from Cloudflare, 530 (error 1033) when no tunnel connector is up.
const ORIGIN_DOWN = new Set([502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 530]);

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="60">
<title>Back shortly · Christopher Guzman</title>
<style>
  :root { color-scheme: light dark; --bg: #f7f8fa; --ink: #1a2230; --muted: #5b6575; --accent: #2f4fa8; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0f1419; --ink: #e7ebf1; --muted: #9aa3b0; --accent: #8fa8f0; } }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--ink);
         font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 34rem; padding: 2rem; }
  h1 { font: 600 2rem/1.2 Georgia, "Times New Roman", serif; margin: 0 0 .75rem; }
  p { color: var(--muted); margin: 0 0 1rem; }
  a { color: var(--accent); }
</style>
</head>
<body>
<main>
  <h1>Back shortly</h1>
  <p>This site runs on a server I operate myself, and it is offline for a few minutes. This page retries on its own.</p>
  <p>In the meantime: <a href="https://github.com/chrisguzman77">GitHub</a> ·
     <a href="https://www.linkedin.com/in/christopher-emmanuel-guzman/">LinkedIn</a></p>
</main>
</body>
</html>`;

function fallback() {
  return new Response(PAGE, {
    status: 503,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "retry-after": "300",
      "cache-control": "no-store",
    },
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.hostname === `www.${APEX}`) {
      url.hostname = APEX;
      return Response.redirect(url.toString(), 301);
    }
    let response;
    try {
      response = await fetch(request);
    } catch {
      return fallback();
    }
    return ORIGIN_DOWN.has(response.status) ? fallback() : response;
  },
};
