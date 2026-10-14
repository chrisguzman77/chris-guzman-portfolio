import type { Element, Root, RootContent } from "hast";
import { toString } from "hast-util-to-string";
import rehypePrettyCode, { type Options as PrettyCodeOptions } from "rehype-pretty-code";
import rehypeSanitize, { defaultSchema, type Options as SanitizeOptions } from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

import { cmsAssetUrl } from "@/lib/cms-assets";

export type Heading = { id: string; text: string; depth: 2 | 3 };

// "/assets/<uuid>", optionally prefixed by any origin (e.g. https://cms.christopherguzman.me).
// The lookbehind stops matches inside other paths such as /static/assets/<uuid> or /cms-assets/.
const ASSET_URL =
  /(?<![\w/.-])(?:https?:\/\/[^\s/()"'<>]+)?\/assets\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;

export function rewriteAssetUrls(md: string): string {
  return md.replace(ASSET_URL, "/cms-assets/$1");
}

const CMS_ASSET_ID =
  /\/cms-assets\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;

// The (lowercased) ids of the Directus files a body links to, for getFileVersions.
export function assetIds(md: string): string[] {
  const ids = [...rewriteAssetUrls(md).matchAll(CMS_ASSET_ID)].map((m) => m[1].toLowerCase());
  return [...new Set(ids)];
}

// GitHub-style sanitization, but keep rehype-slug ids as written (no "user-content-" prefix)
// so table-of-contents anchors match. Highlighting runs after sanitizing, so Shiki's
// inline styles are never stripped.
const sanitizeSchema: SanitizeOptions = { ...defaultSchema, clobberPrefix: "" };

const prettyCodeOptions: PrettyCodeOptions = {
  theme: { dark: "github-dark-dimmed", light: "github-light" },
  keepBackground: false,
};

function walk(node: Root | RootContent, visit: (element: Element) => void): void {
  if (node.type === "element") visit(node);
  if ("children" in node) node.children.forEach((child) => walk(child, visit));
}

// A post page already renders the title as its one h1, so markdown "#" becomes h2.
function demoteH1() {
  return (tree: Root) => {
    walk(tree, (element) => {
      if (element.tagName === "h1") element.tagName = "h2";
    });
  };
}

// Runs after sanitize: a ```mermaid block becomes <pre class="mermaid-source" data-mermaid> holding
// the source as one text node, so markup in it stays text. With no <code> child, rehype-pretty-code
// skips it. The visible source is the fallback when JS is off or the diagram fails to render.
function mermaidBlocks() {
  return (tree: Root) => {
    walk(tree, (element) => {
      const [code] = element.children;
      if (element.tagName !== "pre" || code?.type !== "element" || code.tagName !== "code") return;
      const className = code.properties.className;
      if (!Array.isArray(className) || !className.includes("language-mermaid")) return;
      element.properties = { className: ["mermaid-source"], dataMermaid: "" };
      element.children = [{ type: "text", value: toString(code) }];
    });
  };
}

// Markdown images sit below a page's title and intro and are CMS originals (a post's diagram is a
// 178 KB 2400px PNG). Fetched eagerly, Chrome gives one Medium priority next to the page's first
// paint, which put a post's mobile LCP at 3.6 s instead of 2.7 s. Lazy, they wait for layout.
function lazyImages() {
  return (tree: Root) => {
    walk(tree, (element) => {
      if (element.tagName !== "img") return;
      element.properties.loading = "lazy";
      element.properties.decoding = "async";
    });
  };
}

// A post's column is about 700 CSS px, so a CMS image is fetched as /cms-assets' 1200px WebP
// variant (enough for 2x screens) rather than the full-size original. Links (e.g. a PDF) keep
// the original. Any query the author wrote is replaced: the route accepts only ?w= and ?v=.
// Both get the file's version (?v=, see cmsAssetUrl) when it is known; a link keeps its #hash,
// and a link with its own query is left as written.
const CMS_IMAGE = /^\/cms-assets\/([0-9a-f-]{36})(?:[?#].*)?$/i;
const CMS_LINK = /^\/cms-assets\/([0-9a-f-]{36})(#.*)?$/i;

function versionedCmsAssets(versions: Record<string, string>) {
  const version = (id: string) => versions[id.toLowerCase()];
  return () => (tree: Root) => {
    walk(tree, (element) => {
      if (element.tagName === "img") {
        const match = CMS_IMAGE.exec(String(element.properties.src));
        if (match) element.properties.src = cmsAssetUrl(match[1], version(match[1]), "1200");
      } else if (element.tagName === "a") {
        const match = CMS_LINK.exec(String(element.properties.href));
        if (match) {
          element.properties.href = cmsAssetUrl(match[1], version(match[1])) + (match[2] ?? "");
        }
      }
    });
  };
}

function collectHeadings(headings: Heading[]) {
  return () => (tree: Root) => {
    walk(tree, (element) => {
      const { id } = element.properties;
      if ((element.tagName === "h2" || element.tagName === "h3") && typeof id === "string") {
        headings.push({ id, text: toString(element), depth: element.tagName === "h2" ? 2 : 3 });
      }
    });
  };
}

// `versions` maps file ids to their /cms-assets version (getFileVersions(assetIds(md))).
export async function renderMarkdown(
  md: string,
  versions: Record<string, string> = {},
): Promise<{ html: string; headings: Heading[] }> {
  const headings: Heading[] = [];
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(demoteH1)
    .use(rehypeSlug)
    .use(rehypeSanitize, sanitizeSchema)
    .use(collectHeadings(headings))
    .use(mermaidBlocks)
    .use(lazyImages)
    .use(versionedCmsAssets(versions))
    .use(rehypePrettyCode, prettyCodeOptions)
    .use(rehypeStringify)
    .process(rewriteAssetUrls(md));
  return { html: String(file), headings };
}
