export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[10px] border border-dashed border-input p-3.5 font-mono text-xs text-muted-foreground">
      {children}
    </div>
  );
}
