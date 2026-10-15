import { siteConfig } from "@/lib/site";

// Top-level routes that exist; anything else is a 404. Admin and newsletter pages aren't in the nav.
const SECTIONS = new Set<string>([
  ...siteConfig.nav.map((item) => item.href.slice(1)),
  "newsletter",
  "admin",
]);

// The part of the header logo after ~/chris-guzman: "/projects" for /projects/x.
export function logoSuffix(pathname: string): string {
  const section = pathname.split("/")[1] ?? "";
  if (section === "") return "";
  return SECTIONS.has(section) ? `/${section}` : "/404";
}

// One keystroke of the logo's typing animation: delete until `current` is a prefix of
// `target`, then type the next character.
export function nextFrame(current: string, target: string): string {
  if (!target.startsWith(current)) return current.slice(0, -1);
  return target.slice(0, current.length + 1);
}
