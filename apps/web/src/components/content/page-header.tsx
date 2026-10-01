export function PageHeader({ prompt, title }: { prompt: string; title: string }) {
  return (
    <div>
      <p className="font-mono text-xs text-accent-brand">{prompt}</p>
      <h1 className="mt-2 text-4xl font-semibold tracking-tight">{title}</h1>
    </div>
  );
}
