import { useEffect, useMemo } from "react";
import { CaseSensitive, ChevronRight, CopyMinus, FolderSearch, Loader2, Regex, RefreshCw, Square, WholeWord, X } from "lucide-react";
import { fileIcon } from "@/components/explorer/fileIcon";
import { ViewHeader } from "@/components/layout/ViewHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Hint } from "@/components/ui/tooltip";
import { isDesktop } from "@/lib/backend";
import { fsApi, targetKey, type FsEntry, type FsTarget } from "@/lib/fs";
import { cn } from "@/lib/utils";
import { useExplorerStore } from "@/store/explorerStore";
import { useSearchStore } from "@/store/searchStore";
import { connIdOf, useTabStore } from "@/store/tabStore";

/** "로컬 PC" or the SSH tab's name for a target. */
function useTargetLabel(target: FsTarget | undefined): string {
  const tabs = useTabStore((s) => s.tabs);
  if (!target || target.kind === "local") return "로컬 PC";
  const tab = tabs.find((t) => t.target.type === "ssh" && connIdOf(t) === target.connId);
  return tab ? tab.title : "SSH (연결 끊김)";
}

/** VS Code style find in files over the explorer's folder (local or server). */
export function SearchView() {
  const s = useSearchStore();
  const explorerTarget = useExplorerStore((e) => e.target);
  const explorerRoot = useExplorerStore((e) => e.roots[targetKey(e.target)]);
  const label = useTargetLabel(s.scope?.target);

  // Start in the explorer's folder — or its target's home folder when the
  // explorer hasn't been opened yet this run (it has no folder until then).
  useEffect(() => {
    if (s.scope) return;
    if (explorerRoot !== undefined) s.set({ scope: { target: explorerTarget, dir: explorerRoot } });
    else if (isDesktop) {
      void fsApi
        .home(explorerTarget)
        .then((dir) => !useSearchStore.getState().scope && s.set({ scope: { target: explorerTarget, dir } }))
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [explorerRoot]);

  // Search as you type (debounced), and again when an option changes.
  useEffect(() => {
    const timer = setTimeout(() => void useSearchStore.getState().run(), 350);
    return () => clearTimeout(timer);
  }, [s.query, s.caseSensitive, s.wholeWord, s.regex, s.include, s.exclude, s.scope]);

  const total = useMemo(() => s.results.reduce((n, f) => n + f.matches.length, 0), [s.results]);
  const useExplorerFolder = () =>
    explorerRoot !== undefined && s.set({ scope: { target: explorerTarget, dir: explorerRoot } });

  return (
    <>
      <ViewHeader title="검색">
        <HeaderButton label="다시 검색" onClick={() => void s.run()}>
          <RefreshCw />
        </HeaderButton>
        <HeaderButton
          label="모두 접기"
          onClick={() => s.set({ collapsed: Object.fromEntries(s.results.map((f) => [f.path, true])) })}
        >
          <CopyMinus />
        </HeaderButton>
        <HeaderButton label="지우기" onClick={s.clear}>
          <X />
        </HeaderButton>
      </ViewHeader>

      <div className="grid gap-1.5 px-2 pb-2">
        <div className="relative">
          <Input
            autoFocus
            value={s.query}
            placeholder="검색"
            spellCheck={false}
            onChange={(e) => s.set({ query: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && void s.run()}
            className="h-7 pr-[4.75rem] text-xs"
          />
          <div className="absolute inset-y-0 right-1 flex items-center gap-0.5">
            <Toggle label="대소문자 구분" on={s.caseSensitive} onClick={() => s.set({ caseSensitive: !s.caseSensitive })}>
              <CaseSensitive />
            </Toggle>
            <Toggle label="단어 단위로" on={s.wholeWord} onClick={() => s.set({ wholeWord: !s.wholeWord })}>
              <WholeWord />
            </Toggle>
            <Toggle label="정규식 사용" on={s.regex} onClick={() => s.set({ regex: !s.regex })}>
              <Regex />
            </Toggle>
          </div>
        </div>
        <Input
          value={s.include}
          placeholder="포함할 파일 (예: *.py, src/**)"
          spellCheck={false}
          onChange={(e) => s.set({ include: e.target.value })}
          className="h-7 text-xs"
        />
        <Input
          value={s.exclude}
          placeholder="제외할 파일 (예: *.log, test)"
          spellCheck={false}
          onChange={(e) => s.set({ exclude: e.target.value })}
          className="h-7 text-xs"
        />
        <div className="text-muted-foreground flex items-center gap-1 text-[11px]">
          <span className="min-w-0 flex-1 truncate" title={s.scope?.dir}>
            검색 위치: {label} · <span className="font-mono">{s.scope?.dir || "(탐색기 폴더)"}</span>
          </span>
          <HeaderButton label="탐색기의 현재 폴더에서 검색" onClick={useExplorerFolder}>
            <FolderSearch />
          </HeaderButton>
        </div>
      </div>

      <div className="text-muted-foreground flex min-h-5 items-center gap-1.5 px-3 pb-1 text-[11px]">
        {s.status === "searching" && (
          <>
            <Loader2 className="size-3 animate-spin" />
            <span className="flex-1">
              검색 중… {total > 0 && `${s.results.length}개 파일, ${total}개 결과`}
            </span>
            <button className="hover:text-foreground inline-flex items-center gap-1" onClick={s.cancel}>
              <Square className="size-3" />
              중지
            </button>
          </>
        )}
        {s.status === "done" && s.summary && (
          <span>
            {total === 0
              ? "결과 없음"
              : `${s.results.length}개 파일에서 ${total}개 결과`}
            {s.summary.truncated && " — 결과가 많아 일부만 표시합니다"}
            {s.summary.cancelled && " — 중지됨"}
          </span>
        )}
        {s.status === "error" && <span className="text-destructive break-words">{s.error}</span>}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="pb-4">
          {s.results.map((file) => (
            <FileResult key={file.path} file={file} />
          ))}
        </div>
      </ScrollArea>
    </>
  );
}

function FileResult({ file }: { file: { path: string; matches: { line: number; column: number; length: number; text: string; textOffset: number }[] } }) {
  const scope = useSearchStore((s) => s.scope);
  const collapsed = useSearchStore((s) => !!s.collapsed[file.path]);
  const set = useSearchStore((s) => s.set);
  const sep = scope?.target.kind === "local" ? "\\" : "/";
  const name = file.path.split(/[\\/]/).at(-1) ?? file.path;
  const dir = scope?.dir ?? "";
  const rel = file.path.startsWith(dir) ? file.path.slice(dir.length).replace(/^[\\/]/, "") : file.path;
  const relDir = rel.includes(sep) || rel.includes("/") ? rel.slice(0, rel.length - name.length - 1) : "";
  const Icon = fileIcon({ name, isDir: false } as FsEntry, false);

  const open = (m: { line: number; column: number; length: number }) => {
    if (!scope) return;
    useTabStore.getState().openEditor(scope.target, file.path, undefined, m);
  };

  return (
    <div>
      <button
        title={file.path}
        onClick={() => set({ collapsed: { ...useSearchStore.getState().collapsed, [file.path]: !collapsed } })}
        className="hover:bg-accent/50 flex h-6 w-full items-center gap-1 pr-2 pl-1.5 text-left text-[13px]"
      >
        <ChevronRight className={cn("text-muted-foreground size-4 shrink-0 transition-transform", !collapsed && "rotate-90")} />
        <Icon className="text-muted-foreground size-4 shrink-0" />
        <span className="shrink-0">{name}</span>
        <span className="text-muted-foreground min-w-0 flex-1 truncate text-[11px]">{relDir}</span>
        <span className="bg-muted text-muted-foreground shrink-0 rounded-full px-1.5 text-[10px] tabular-nums">
          {file.matches.length}
        </span>
      </button>
      {!collapsed &&
        file.matches.map((m, i) => {
          const before = m.text.slice(0, m.textOffset).trimStart();
          const hit = m.text.slice(m.textOffset, m.textOffset + m.length);
          const after = m.text.slice(m.textOffset + m.length);
          return (
            <button
              key={i}
              title={`${m.line}번째 줄`}
              onClick={() => open(m)}
              className="hover:bg-accent/50 flex h-[22px] w-full items-center gap-2 pr-2 pl-9 text-left text-xs"
            >
              <span className="min-w-0 flex-1 truncate font-mono">
                {before}
                <mark className="bg-warning/30 text-foreground rounded-sm">{hit}</mark>
                {after}
              </span>
              <span className="text-muted-foreground shrink-0 text-[10px] tabular-nums">{m.line}</span>
            </button>
          );
        })}
    </div>
  );
}

function HeaderButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Hint label={label}>
      <Button variant="ghost" size="iconSm" className="size-6 shrink-0" onClick={onClick} aria-label={label}>
        {children}
      </Button>
    </Hint>
  );
}

function Toggle({ label, on, onClick, children }: { label: string; on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Hint label={label}>
      <button
        aria-label={label}
        aria-pressed={on}
        onClick={onClick}
        className={cn(
          "flex size-5 items-center justify-center rounded-sm [&_svg]:size-3.5",
          on ? "bg-primary/25 text-foreground ring-primary/60 ring-1" : "text-muted-foreground hover:bg-accent",
        )}
      >
        {children}
      </button>
    </Hint>
  );
}

