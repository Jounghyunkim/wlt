import { useMemo, useState } from "react";
import {
  ChevronRight,
  Copy,
  Pencil,
  Plus,
  Search,
  Server,
  SquareTerminal,
  Trash2,
} from "lucide-react";
import { ExplorerView } from "@/components/explorer/ExplorerView";
import { HistoryView } from "@/components/history/HistoryView";
import { SearchView } from "@/components/search/SearchView";
import { ViewHeader } from "./ViewHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Hint } from "@/components/ui/tooltip";
import type { ShellInfo } from "@/lib/backend";
import { cn } from "@/lib/utils";
import { useSessionStore, type SshSession } from "@/store/sessionStore";
import {
  DEFAULT_SETTINGS,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  useSettingsStore,
} from "@/store/settingsStore";

interface SidebarProps {
  shells: ShellInfo[];
  onOpenShell: (shell: ShellInfo) => void;
  onConnect: (session: SshSession) => void;
  onNewSession: () => void;
  onEditSession: (session: SshSession) => void;
}

/** Resizable panel next to the activity bar, showing the selected view. */
export function Sidebar(props: SidebarProps) {
  const sidebarWidth = useSettingsStore((s) => s.sidebarWidth);
  const view = useSettingsStore((s) => s.sidebarView);
  const side = useSettingsStore((s) => s.sidebarSide);

  return (
    <aside
      className={cn("bg-sidebar relative flex h-full shrink-0 flex-col", side === "left" ? "border-r" : "border-l")}
      style={{ width: sidebarWidth }}
    >
      <ResizeHandle side={side} />
      {view === "explorer" ? <ExplorerView /> : view === "history" ? <HistoryView /> : view === "search" ? <SearchView /> : <TerminalsView {...props} />}
      <p className="text-muted-foreground border-t px-3 py-1.5 text-[11px]">WLT v0.1.0 · by JohnnyStudio</p>
    </aside>
  );
}

function TerminalsView({ shells, onOpenShell, onConnect, onNewSession, onEditSession }: SidebarProps) {
  const sessions = useSessionStore((s) => s.sessions);
  const removeSession = useSessionStore((s) => s.removeSession);
  const duplicateSession = useSessionStore((s) => s.duplicateSession);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = sessions
      .filter((s) => !q || [s.name, s.host, s.username, s.group].some((v) => v.toLowerCase().includes(q)))
      .sort((a, b) => a.name.localeCompare(b.name));
    const map = new Map<string, SshSession[]>();
    for (const s of filtered) {
      const key = s.group || "";
      map.set(key, [...(map.get(key) ?? []), s]);
    }
    // Ungrouped sessions last.
    return [...map.entries()].sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
  }, [sessions, query]);

  return (
    <>
      <ViewHeader title="터미널">
        <Hint label="새 SSH 세션">
          <Button variant="ghost" size="iconSm" onClick={onNewSession}>
            <Plus />
          </Button>
        </Hint>
      </ViewHeader>

      <ScrollArea className="min-h-0 flex-1">
        <SectionTitle>로컬 셸</SectionTitle>
        <div className="px-2 pb-2">
          {shells.map((sh) => (
            <button
              key={sh.command}
              onClick={() => onOpenShell(sh)}
              className="hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm"
            >
              <SquareTerminal className="text-muted-foreground size-4" />
              <span className="truncate">{sh.name}</span>
            </button>
          ))}
        </div>

        <SectionTitle>SSH 세션</SectionTitle>

        <div className="relative px-2 pb-2">
          <Search className="text-muted-foreground absolute top-2 left-4 size-3.5" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="세션 검색"
            className="h-7 pl-7 text-xs"
          />
        </div>

        {sessions.length === 0 && (
          <div className="text-muted-foreground px-4 py-6 text-center text-xs leading-relaxed">
            저장된 세션이 없습니다.
            <br />
            <button className="text-primary mt-1 hover:underline" onClick={onNewSession}>
              새 SSH 세션 추가
            </button>
          </div>
        )}

        <div className="px-2 pb-4">
          {grouped.map(([group, items]) => {
            const isCollapsed = group !== "" && collapsed[group];
            return (
              <div key={group || "__none"}>
                {group && (
                  <button
                    className="text-muted-foreground hover:text-foreground flex w-full items-center gap-1 px-1 py-1 text-xs font-medium"
                    onClick={() => setCollapsed((c) => ({ ...c, [group]: !c[group] }))}
                  >
                    <ChevronRight className={cn("size-3.5 transition-transform", !isCollapsed && "rotate-90")} />
                    {group}
                    <span className="ml-auto tabular-nums">{items.length}</span>
                  </button>
                )}
                {!isCollapsed &&
                  items.map((s) => (
                    <SessionItem
                      key={s.id}
                      session={s}
                      indented={!!group}
                      onConnect={() => onConnect(s)}
                      onEdit={() => onEditSession(s)}
                      onDuplicate={() => duplicateSession(s.id)}
                      onDelete={() => {
                        if (confirm(`'${s.name}' 세션을 삭제할까요?`)) removeSession(s.id);
                      }}
                    />
                  ))}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </>
  );
}

/** Drag handle on the sidebar's inner edge. Double-click restores the default width. */
function ResizeHandle({ side }: { side: "left" | "right" }) {
  const update = useSettingsStore((s) => s.update);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = useSettingsStore.getState().sidebarWidth;
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    setDragging(true);
    // Keep the resize cursor and suppress text selection even when the pointer outruns the handle.
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev: PointerEvent) => {
      // On the right side the handle is on the sidebar's left edge, so dragging left widens it.
      const delta = (ev.clientX - startX) * (side === "left" ? 1 : -1);
      const width = Math.round(startWidth + delta);
      update({ sidebarWidth: Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width)) });
    };
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setDragging(false);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="사이드바 너비 조절"
      title="드래그하여 너비 조절 · 더블클릭하면 기본값"
      onPointerDown={onPointerDown}
      onDoubleClick={() => update({ sidebarWidth: DEFAULT_SETTINGS.sidebarWidth })}
      className={cn(
        "hover:bg-primary/60 absolute inset-y-0 z-20 w-2 cursor-col-resize transition-colors",
        side === "left" ? "-right-1" : "-left-1",
        dragging && "bg-primary/60",
      )}
    />
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-muted-foreground px-4 pt-3 pb-1.5 text-[11px] font-semibold tracking-wider uppercase">
      {children}
    </div>
  );
}

interface SessionItemProps {
  session: SshSession;
  indented: boolean;
  onConnect: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

function SessionItem({ session, indented, onConnect, onEdit, onDuplicate, onDelete }: SessionItemProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      title="더블클릭하여 연결"
      onDoubleClick={onConnect}
      onKeyDown={(e) => e.key === "Enter" && onConnect()}
      className={cn(
        "group hover:bg-accent focus-visible:bg-accent flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 outline-none",
        indented && "pl-5",
      )}
    >
      <Server className="text-muted-foreground size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{session.name}</div>
        <div className="text-muted-foreground truncate font-mono text-[11px]">
          {session.username}@{session.host}
          {session.port !== 22 && `:${session.port}`}
        </div>
      </div>
      <div className="hidden shrink-0 items-center group-hover:flex group-focus-within:flex">
        <IconAction label="편집" onClick={onEdit}>
          <Pencil />
        </IconAction>
        <IconAction label="복제" onClick={onDuplicate}>
          <Copy />
        </IconAction>
        <IconAction label="삭제" onClick={onDelete} destructive>
          <Trash2 />
        </IconAction>
      </div>
    </div>
  );
}

function IconAction({
  label,
  onClick,
  destructive,
  children,
}: {
  label: string;
  onClick: () => void;
  destructive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Hint label={label}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        onDoubleClick={(e) => e.stopPropagation()}
        className={cn(
          "text-muted-foreground hover:text-foreground rounded p-1 [&_svg]:size-3.5",
          destructive && "hover:text-destructive",
        )}
      >
        {children}
      </button>
    </Hint>
  );
}
