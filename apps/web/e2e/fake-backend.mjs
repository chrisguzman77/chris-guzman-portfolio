// Fake Directus + portfolio API for the Playwright journey. Plain node:http, no dependencies.
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const ORIGIN = "http://127.0.0.1:3100";
const SINGLETONS = new Set(["profile", "resume", "chat_settings"]);

// The smallest valid one-page PDF, so the resume <object> and /cms-assets proxy load cleanly.
const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);

function fixture(kind, name) {
  return JSON.parse(readFileSync(path.join(fixtures, kind, `${name}.json`), "utf8"));
}

function send(res, status, body, type = "application/json") {
  res.writeHead(status, { "Content-Type": type, "Access-Control-Allow-Origin": ORIGIN });
  res.end(type === "application/json" ? JSON.stringify(body) : body);
}

function directusItems(res, collection, query) {
  let data;
  try {
    data = fixture("directus", collection);
  } catch {
    return send(res, 404, { errors: [{ message: "not found" }] });
  }
  if (!SINGLETONS.has(collection)) {
    const slug = query.get("filter[slug][_eq]");
    if (slug !== null) data = data.filter((item) => item.slug === slug);
  }
  send(res, 200, { data });
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const route = `${req.method} ${url.pathname}`;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": ORIGIN,
      "Access-Control-Allow-Methods": "GET, POST",
      "Access-Control-Allow-Headers": "content-type, x-request-id",
    });
    return res.end();
  }

  const items = /^GET \/items\/([a-z_]+)$/.exec(route);
  if (items) return directusItems(res, items[1], url.searchParams);
  if (/^GET \/assets\/[0-9a-f-]+$/.test(route)) return send(res, 200, PDF, "application/pdf");

  switch (route) {
    case "GET /v1/status":
      return send(res, 200, fixture("api", "status"));
    case "GET /v1/github/activity":
      return send(res, 200, fixture("api", "github-activity"));
    case "POST /v1/contact":
      return send(res, 202, {});
    case "POST /v1/chat/sessions":
      return send(res, 201, fixture("api", "chat-session"));
    case "POST /v1/chat/sessions/s1/messages":
      return send(res, 200, fixture("api", "chat-message"));
    default:
      return send(res, 404, { error: { code: "not_found", message: "not found" } });
  }
});

server.listen(3101, "127.0.0.1", () => console.log("fake backend on http://127.0.0.1:3101"));
