import { ChevronDown } from "lucide-react";

import { Prose } from "@/components/content/prose";

// `html` must come from renderMarkdown(), which sanitizes it.
export type FaqItem = { id: number; question: string; html: string };

export function FaqSection({ items }: { items: FaqItem[] }) {
  return (
    <section aria-labelledby="contact-faq" className="mt-8">
      <h2 id="contact-faq" className="mb-3 text-[15px] font-semibold">
        Questions recruiters ask
      </h2>
      <div className="flex flex-col gap-2.5">
        {items.map((item) => (
          <details
            key={item.id}
            className="group rounded-[10px] border border-border bg-card px-4 py-3"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-sm text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-brand">
              {item.question}
              <ChevronDown
                className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
                aria-hidden
              />
            </summary>
            <div className="mt-2 text-sm">
              <Prose html={item.html} />
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
