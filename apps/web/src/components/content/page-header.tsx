import { cn } from "@/lib/utils";

export function PageHeader({ prompt, title }: { prompt?: string; title: string }) {
  return (
    <div>
      {prompt ? <p className="font-mono text-xs text-accent-brand">{prompt}</p> : null}
      <h1 className={cn("text-3xl font-semibold tracking-tight", prompt && "mt-4")}>{title}</h1>
    </div>
  );
}
