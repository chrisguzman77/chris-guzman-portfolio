import { siteConfig } from "@/lib/site";

// Top-level routes that exist; anything else is a 404. Admin and newsletter pages aren't in the nav.
const SECTIONS = new Set<string>([
  ...siteConfig.nav.map((item) => item.href.slice(1)),
  "newsletter",
  "admin",
]);

// Sections whose /section/<slug> pages are documents, shown in the logo as <slug>.md.
const DOCUMENT_SECTIONS = new Set(["blog", "projects"]);

// The part of the header logo after ~/chris-guzman: "/projects" on the list,
// "/projects/this-portfolio.md" on a project, "/404" for an unknown section.
export function logoSuffix(pathname: string): string {
  const [, section = "", slug, ...deeper] = pathname.split("/");
  if (section === "") return "";
  if (!SECTIONS.has(section)) return "/404";
  if (DOCUMENT_SECTIONS.has(section) && slug && deeper.length === 0) {
    return `/${section}/${slug}.md`;
  }
  return `/${section}`;
}

// The clickable section of a document path ("/blog" in "/blog/x.md"), or null.
export function logoCrumb(target: string): string | null {
  const match = /^\/([a-z]+)\/[^/]+\.md$/.exec(target);
  return match && DOCUMENT_SECTIONS.has(match[1]) ? `/${match[1]}` : null;
}

// One keystroke of the logo's typing animation: delete until `current` is a prefix of
// `target`, then type the next character.
export function nextFrame(current: string, target: string): string {
  if (!target.startsWith(current)) return current.slice(0, -1);
  return target.slice(0, current.length + 1);
}
