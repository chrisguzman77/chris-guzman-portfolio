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

export type Heading = { id: string; text: string; depth: 2 | 3 };

// "/assets/<uuid>", optionally prefixed by any origin (e.g. https://cms.christopherguzman.me).
// The lookbehind stops matches inside other paths such as /static/assets/<uuid> or /cms-assets/.
const ASSET_URL =
  /(?<![\w/.-])(?:https?:\/\/[^\s/()"'<>]+)?\/assets\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;

export function rewriteAssetUrls(md: string): string {
  return md.replace(ASSET_URL, "/cms-assets/$1");
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

export async function renderMarkdown(md: string): Promise<{ html: string; headings: Heading[] }> {
  const headings: Heading[] = [];
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeSlug)
    .use(rehypeSanitize, sanitizeSchema)
    .use(collectHeadings(headings))
    .use(rehypePrettyCode, prettyCodeOptions)
    .use(rehypeStringify)
    .process(rewriteAssetUrls(md));
  return { html: String(file), headings };
}
