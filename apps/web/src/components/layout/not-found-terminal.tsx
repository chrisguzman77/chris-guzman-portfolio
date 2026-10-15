"use client";

import { usePathname, useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { runCommand } from "@/lib/not-found-terminal";

const PROMPT = "visitor@chris:~$";

// The 404 page's terminal. Plain links to every page are always rendered below it (not-found.tsx),
// so the page works without JS.
export function NotFoundTerminal() {
  const pathname = usePathname();
  const router = useRouter();
  const [lines, setLines] = useState<string[]>([]);
  const [value, setValue] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = runCommand(value);
    setValue("");
    if (result.clear) {
      setLines([]);
      return;
    }
    setLines((previous) => [...previous, `${PROMPT} ${value}`, ...result.output]);
    if (result.navigate) router.push(result.navigate);
  }

  return (
    <section
      aria-label="Terminal"
      className="mt-6 rounded-[10px] border border-border bg-card p-4 font-mono text-[13px] leading-relaxed"
    >
      <p className="break-words text-foreground">
        {`bash: ${pathname}: No such file or directory (404)`}
      </p>
      <p className="text-muted-foreground">
        type <span className="text-accent-brand">help</span> for commands, or{" "}
        <span className="text-accent-brand">ls</span> to list the pages
      </p>
      <div aria-live="polite" className="mt-2 whitespace-pre-wrap break-words text-foreground">
        {lines.map((line, index) => (
          <p key={index}>{line}</p>
        ))}
      </div>
      <form onSubmit={submit} className="mt-1 flex items-center gap-2">
        <span aria-hidden="true" className="shrink-0 text-accent-brand">
          {PROMPT}
        </span>
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-label="Terminal command (try help)"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-sm text-base sm:text-[13px] bg-transparent px-1 text-foreground caret-accent-brand focus-visible:outline-2 focus-visible:outline-accent-brand"
        />
      </form>
    </section>
  );
}
