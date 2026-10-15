import { siteConfig } from "@/lib/site";

export type TerminalResult = { output: string[]; navigate?: string; clear?: boolean };

export const TERMINAL_PAGES: readonly string[] = [
  "home",
  ...siteConfig.nav.map((item) => item.href.slice(1)),
];

const HELP = [
  "commands:",
  "  help          show this list",
  "  ls            list the pages",
  "  cd <page>     go to a page",
  "  cat resume    open the resume",
  "  whoami        who are you?",
  "  clear         clear the screen",
];

// "projects", "/projects/", "~/projects" → "/projects"; "", "~", "home" → "/".
function pageHref(name: string): string | null {
  const page = name
    .toLowerCase()
    .replace(/^~/, "")
    .replace(/^\/|\/$/g, "");
  if (page === "" || page === "home") return "/";
  return TERMINAL_PAGES.includes(page) ? `/${page}` : null;
}

// The 404 page's toy shell. Output is plain strings; React renders them as text, so input can't
// inject markup.
export function runCommand(input: string): TerminalResult {
  const [command = "", ...args] = input.trim().split(/\s+/);
  const arg = args.join(" ");
  switch (command.toLowerCase()) {
    case "":
      return { output: [] };
    case "help":
      return { output: HELP };
    case "ls":
      return { output: [TERMINAL_PAGES.join("  ")] };
    case "cd": {
      const href = pageHref(arg);
      return href ? { output: [], navigate: href } : { output: [`cd: no such page: ${arg}`] };
    }
    case "cat":
      return /^resume(\.pdf)?$/i.test(arg)
        ? { output: [], navigate: "/resume" }
        : { output: [`cat: ${arg}: No such file or directory`] };
    case "whoami":
      return { output: ["visitor", "(looking for Chris? try: cd ~)"] };
    case "clear":
      return { output: [], clear: true };
    default:
      return { output: [`command not found: ${command} (try help)`] };
  }
}
