/** VS Code style sidebar view title with optional actions on the right. */
export function ViewHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex h-[30px] shrink-0 items-center gap-1 pr-1.5 pl-4">
      <span className="text-muted-foreground min-w-0 flex-1 truncate text-[11px] font-semibold tracking-wider uppercase">
        {title}
      </span>
      {children}
    </div>
  );
}
