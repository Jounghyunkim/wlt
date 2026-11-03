import { useEffect, useMemo, useState } from "react";
import {
  Columns2,
  Copy,
  FolderOpen,
  History,
  Plug,
  Power,
  RotateCcw,
  Search,
  Server,
  SquareTerminal,
  Trash2,
} from "lucide-react";
import { showSidebarView } from "@/components/layout/ActivityBar";
import { ViewHeader } from "@/components/layout/ViewHeader";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Hint } from "@/components/ui/tooltip";
import { LOCAL } from "@/lib/fs";
import { cn } from "@/lib/utils";
import { useExplorerStore } from "@/store/explorerStore";
import { useHistoryStore, type HistoryEntry } from "@/store/historyStore";
import { useSettingsStore } from "@/store/settingsStore";
import { useTabStore } from "@/store/tabStore";

function targetLabel(e: HistoryEntry): string {
  if (e.target.type === "ssh") {
    const { username, host, port } = e.target.config;
    return `${username}@${host}${port !== 22 ? `:${port}` : ""}`;
  }
  const program = e.target.shell?.split(/\s+/)[0]?.split(/[\\/]/).at(-1)?.replace(/"/g, "");
  return program || "기본 셸";
}

function relativeTime(t: number, now: number): string {
  const min = Math.floor((now - t) / 60_000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const d = new Date(t);
  const sameDay = new Date(now).toDateString() === d.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleString([], { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Closed tabs: live ones (instant return) first, then by day. */
export function HistoryView() {
  const entries = useHistoryStore((s) => s.entries);
  const clear = useHistoryStore((s) => s.clear);
  const tabs = useTabStore((s) => s.tabs);
  const keepMinutes = useSettingsStore((s) => s.historyKeepMinutes);
  const onTabClose = useSettingsStore((s) => s.historyOnTabClose);
  const [query, setQuery] = useState("");
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    const visible = entries.filter(
      (e) => !q || [e.title, targetLabel(e), e.cwd ?? ""].some((v) => v.toLowerCase().includes(q)),
    );
    const isLive = (e: HistoryEntry) => !!e.parkedTabId && tabs.some((t) => t.id === e.parkedTabId && t.parkedAt);
    const today = new Date(now).toDateString();
    const yesterday = new Date(now - 86_400_000).toDateString();
    const groups: { title: string; live?: boolean; items: HistoryEntry[] }[] = [
      { title: "이어서 작업 가능 (보관 중)", live: true, items: [] },
      { title: "오늘", items: [] },
      { title: "어제", items: [] },
      { title: "이전", items: [] },
    ];
    for (const e of visible) {
      const day = new Date(e.closedAt).toDateString();
      groups[isLive(e) ? 0 : day === today ? 1 : day === yesterday ? 2 : 3].items.push(e);
    }
    return groups.filter((g) => g.items.length);
  }, [entries, tabs, query, now]);

  return (
    <>
      <ViewHeader title="세션 히스토리">
        {entries.length > 0 && (
          <Hint label="모두 지우기">
            <Button
              variant="ghost"
              size="iconSm"
              className="size-6"
              aria-label="모두 지우기"
              onClick={() => {
                if (confirm("세션 히스토리를 모두 지울까요? 보관 중인 세션도 종료됩니다.")) clear();
              }}
            >
              <Trash2 />
            </Button>
          </Hint>
        )}
      </ViewHeader>

      <div className="relative px-2 pb-2">
        <Search className="text-muted-foreground absolute top-2 left-4 size-3.5" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="이름 · 호스트 · 폴더 검색"
          className="h-7 pl-7 text-xs"
        />
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {entries.length === 0 && (
          <div className="text-muted-foreground flex flex-col items-center gap-2 px-6 py-10 text-center text-xs leading-relaxed">
            <History className="size-8 opacity-40" strokeWidth={1.5} />
            {onTabClose ? "닫은 탭과 앱을 종료할 때 열려 있던 탭이" : "앱을 종료할 때 열려 있던 탭이"} 여기에 쌓입니다.
            <br />
            클릭하면 같은 셸·서버의 작업하던 폴더로 돌아갑니다.
            {onTabClose && keepMinutes > 0 && ` 닫은 지 ${keepMinutes}분 안이면 하던 작업 그대로 이어집니다.`}
          </div>
        )}
        <div className="px-2 pb-4">
          {sections.map((section) => (
            <div key={section.title}>
              <div className="text-muted-foreground px-2 pt-3 pb-1 text-[11px] font-semibold tracking-wider uppercase">
                {section.title}
              </div>
              {section.items.map((e) => (
                <HistoryItem key={e.id} entry={e} live={!!section.live} now={now} keepMinutes={keepMinutes} />
              ))}
            </div>
          ))}
        </div>
      </ScrollArea>
    </>
  );
}

function HistoryItem({
  entry: e,
  live,
  now,
  keepMinutes,
}: {
  entry: HistoryEntry;
  live: boolean;
  now: number;
  keepMinutes: number;
}) {
  const { restore, remove, release } = useHistoryStore.getState();
  const Icon = e.target.type === "ssh" ? Server : SquareTerminal;
  const leftMin = Math.max(0, Math.ceil((e.closedAt + keepMinutes * 60_000 - now) / 60_000));
  const tooltip = [
    e.title,
    targetLabel(e),
    e.cwd ? `폴더: ${e.cwd}` : "폴더 정보 없음 (홈 폴더에서 시작)",
    `닫은 시각: ${new Date(e.closedAt).toLocaleString()}`,
    live ? `보관 중 — 약 ${leftMin}분 뒤 종료 (이후엔 다시 연결)` : "클릭하면 다시 연결합니다",
  ].join("\n");

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="button"
          tabIndex={0}
          title={tooltip}
          onClick={() => restore(e.id)}
          onKeyDown={(k) => k.key === "Enter" && restore(e.id)}
          className="group hover:bg-accent focus-visible:bg-accent flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 outline-none"
        >
          <span className="relative shrink-0">
            <Icon className="text-muted-foreground size-4" />
            <span
              className={cn(
                "ring-sidebar absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2",
                live ? "bg-success" : "bg-muted-foreground/60",
              )}
            />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate text-sm">{e.title}</span>
              <span className="text-muted-foreground shrink-0 text-[11px] tabular-nums">{relativeTime(e.closedAt, now)}</span>
            </div>
            <div className="text-muted-foreground truncate font-mono text-[11px]">
              {targetLabel(e)}
              {e.cwd && ` · ${e.cwd}`}
            </div>
          </div>
          {live && (
            <Hint label="보관 종료 (다음엔 다시 연결)">
              <button
                aria-label="보관 종료"
                className="text-muted-foreground hover:text-foreground hidden rounded p-1 group-hover:block group-focus-within:block [&_svg]:size-3.5"
                onClick={(ev) => {
                  ev.stopPropagation();
                  void release(e.id);
                }}
              >
                <Power />
              </button>
            </Hint>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent onCloseAutoFocus={(ev) => ev.preventDefault()}>
        <ContextMenuItem onSelect={() => restore(e.id)}>
          <RotateCcw />
          {live ? "이어서 작업" : "다시 연결해서 복귀"}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => restore(e.id, { split: "right" })}>
          <Columns2 />
          오른쪽에 분할하여 복귀
        </ContextMenuItem>
        {live && (
          <ContextMenuItem onSelect={() => restore(e.id, { fresh: true })}>
            <Plug />새 연결로 열기
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem disabled={!e.cwd} onSelect={() => e.cwd && void navigator.clipboard.writeText(e.cwd)}>
          <Copy />
          경로 복사
        </ContextMenuItem>
        {e.target.type === "local" && e.cwd && (
          <ContextMenuItem
            onSelect={() => {
              const explorer = useExplorerStore.getState();
              explorer.setRoot(e.cwd!, LOCAL);
              explorer.setTarget(LOCAL);
              showSidebarView("explorer");
            }}
          >
            <FolderOpen />
            탐색기에서 열기
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        {live && (
          <ContextMenuItem onSelect={() => void release(e.id)}>
            <Power />
            보관 종료
          </ContextMenuItem>
        )}
        <ContextMenuItem variant="destructive" onSelect={() => remove(e.id)}>
          <Trash2 />
          히스토리에서 삭제
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
