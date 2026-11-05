import { useEffect, useRef, useState } from "react";
import {
  Check,
  ClipboardCopy,
  Columns2,
  Copy,
  Lock,
  LockOpen,
  Palette,
  PanelLeft,
  Pencil,
  Plus,
  RotateCw,
  Save,
  Rows2,
  Monitor,
  Server,
  SquareTerminal,
  TextSelect,
  X,
  XSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Hint } from "@/components/ui/tooltip";
import type { ShellInfo } from "@/lib/backend";
import { beginPointerDrag, registerDrop, useDnd } from "@/lib/dnd";
import { editorRegistry } from "@/components/editor/EditorPane";
import { fileIcon } from "@/components/explorer/fileIcon";
import type { FsEntry } from "@/lib/fs";
import { THEMES, type ThemeName } from "@/lib/themes";
import { terminalRegistry } from "@/lib/terminalRegistry";
import { cn } from "@/lib/utils";
import { groupSessions, useSessionStore, type SshSession } from "@/store/sessionStore";
import { orderShells, useSettingsStore } from "@/store/settingsStore";
import { useTabStore, type TabStatus } from "@/store/tabStore";

const STATUS_COLOR: Record<TabStatus, string> = {
  connecting: "bg-warning animate-pulse",
  connected: "bg-success",
  closed: "bg-muted-foreground",
  error: "bg-destructive",
};

/**
 * Where a tab dropped on tab `el` goes: before it (left half) or before the
 * next tab (right half; "end" after the last one).
 */
function insertionPoint(el: HTMLElement, x: number): string {
  const rect = el.getBoundingClientRect();
  if (x <= rect.left + rect.width / 2) return el.dataset.tabId!;
  return el.dataset.nextTabId || "end";
}

registerDrop("tab", (payload, el, x) => {
  if (payload.kind !== "tab") return;
  const before = insertionPoint(el, x);
  useTabStore.getState().moveTab(payload.tabId, el.dataset.groupId!, before === "end" ? undefined : before);
});

registerDrop("tabbar", (payload, el) => {
  if (payload.kind === "tab") useTabStore.getState().moveTab(payload.tabId, el.dataset.groupId!);
});

/** What the tab bar's "+" menu asked to open. */
export type NewTabPick =
  | { type: "ssh"; session: SshSession }
  | { type: "shell"; shell: ShellInfo }
  | { type: "new-session" };

interface TabBarProps {
  groupId: string;
  /** Only the top-left group carries the sidebar toggle. */
  showSidebarToggle: boolean;
  shells: ShellInfo[];
  onNewTab: (pick: NewTabPick) => void;
  onSplitRight: () => void;
}

export function TabBar({ groupId, showSidebarToggle, shells, onNewTab, onSplitRight }: TabBarProps) {
  const group = useTabStore((s) => s.groups[groupId]);
  const allTabs = useTabStore((s) => s.tabs);
  const focused = useTabStore((s) => s.focusedGroupId === groupId);
  const draggingTabId = useDnd((s) => (s.payload?.kind === "tab" ? s.payload.tabId : null));
  /** Drop indicator: insert before this tab id, or "end". */
  const dropBefore = useDnd((s) => {
    if (s.payload?.kind !== "tab" || s.over?.dataset.groupId !== groupId) return null;
    if (s.over.dataset.drop === "tab") return insertionPoint(s.over, s.x);
    return s.over.dataset.drop === "tabbar" ? "end" : null;
  });
  const setActiveTab = useTabStore((s) => s.setActiveTab);
  const closeTab = useTabStore((s) => s.closeTab);
  const toggleSidebar = useTabStore((s) => s.toggleSidebar);
  const toggleLock = useTabStore((s) => s.toggleLock);
  const renameTab = useTabStore((s) => s.renameTab);
  const [editingTabId, setEditingTabId] = useState<string | null>(null);

  if (!group) return null;
  const tabs = group.tabIds.map((id) => allTabs.find((t) => t.id === id)).filter((t) => t !== undefined);

  return (
    <div className="bg-sidebar flex h-[30px] shrink-0 items-end border-b">
      {showSidebarToggle && (
        <Hint label="사이드바 (Ctrl+Shift+B)">
          <Button variant="ghost" size="icon" className="h-[30px] w-[30px] shrink-0 rounded-none [&_svg]:size-3.5" onClick={toggleSidebar}>
            <PanelLeft />
          </Button>
        </Hint>
      )}

      <div
        className="flex h-full min-w-0 flex-1 items-end overflow-x-auto [scrollbar-width:none]"
        data-drop="tabbar"
        data-group-id={groupId}
      >
        {tabs.map((tab, i) => {
          const active = tab.id === group.activeTabId;
          const Icon =
            tab.target.type === "editor"
              ? fileIcon({ name: tab.title, isDir: false } as FsEntry, false)
              : tab.target.type === "ssh"
                ? Server
                : SquareTerminal;
          const editing = editingTabId === tab.id;
          return (
            <TabMenu
              key={tab.id}
              tabId={tab.id}
              editorPath={tab.target.type === "editor" ? tab.target.path : undefined}
              locked={tab.locked}
              canCloseOthers={tabs.some((t) => t.id !== tab.id && !t.locked)}
              onRename={() => setEditingTabId(tab.id)}
            >
              <div
                data-drop="tab"
                data-tab-id={tab.id}
                data-next-tab-id={tabs[i + 1]?.id ?? ""}
                data-group-id={groupId}
                onPointerDown={(e) => {
                  if (editing) return;
                  beginPointerDrag(e, () => ({ kind: "tab", tabId: tab.id, label: tab.title }));
                }}
                onMouseDown={(e) => {
                  if (e.button === 0) setActiveTab(tab.id);
                }}
                onAuxClick={(e) => {
                  if (e.button === 1) closeTab(tab.id);
                }}
                title={tab.title}
                className={cn(
                  "group relative flex h-7 max-w-44 min-w-24 shrink-0 cursor-default items-center gap-1.5 border-r px-2.5 text-xs",
                  active
                    ? "bg-background text-foreground"
                    : "text-muted-foreground hover:bg-background/50 hover:text-foreground",
                  draggingTabId === tab.id && "opacity-50",
                )}
              >
                {active && (
                  <span
                    className={cn("absolute inset-x-0 top-0 h-0.5", focused ? "bg-primary" : "bg-muted-foreground/50")}
                  />
                )}
                {dropBefore === tab.id && <DropMarker />}
                <Icon className="size-3 shrink-0" />
                {editing ? (
                  <RenameInput
                    initial={tab.title}
                    onDone={(name) => {
                      if (name !== null) renameTab(tab.id, name);
                      setEditingTabId(null);
                    }}
                  />
                ) : (
                  <span className="min-w-0 flex-1 truncate" onDoubleClick={() => setEditingTabId(tab.id)}>
                    {tab.title}
                  </span>
                )}
                {tab.target.type === "editor" ? (
                  // Unsaved changes: a dot, like VS Code.
                  tab.dirty && <span className="bg-foreground size-1.5 shrink-0 rounded-full" title="저장하지 않은 변경 내용" />
                ) : (
                  <span className={cn("size-1.5 shrink-0 rounded-full", STATUS_COLOR[tab.status])} />
                )}
                {tab.locked ? (
                  <button
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => toggleLock(tab.id)}
                    className="hover:bg-accent text-warning -mr-1 rounded p-0.5"
                    title="잠긴 탭 (클릭하여 잠금 해제)"
                    aria-label="탭 잠금 해제"
                  >
                    <Lock className="size-3" />
                  </button>
                ) : (
                  <button
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => closeTab(tab.id)}
                    className={cn(
                      "hover:bg-accent -mr-1 rounded p-0.5",
                      active ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                    )}
                    aria-label="탭 닫기"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </div>
            </TabMenu>
          );
        })}
        <div className="relative flex h-full shrink-0 items-end">
          {dropBefore === "end" && <DropMarker />}
          <NewTabMenu shells={shells} onPick={onNewTab} />
        </div>
      </div>

      <Hint label="오른쪽에 새 터미널 분할 (Ctrl+Shift+\)">
        <Button variant="ghost" size="icon" className="mr-1 mb-0.5 size-6 shrink-0 [&_svg]:size-3.5" onClick={onSplitRight}>
          <Columns2 />
        </Button>
      </Hint>
    </div>
  );
}

/** Inline tab title editor: Enter or blur saves, Esc cancels (`null`). */
function RenameInput({ initial, onDone }: { initial: string; onDone: (name: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const finish = (name: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(name);
  };

  useEffect(() => {
    // Deferred so the closing context menu or the terminal can't take focus back afterwards.
    const timer = setTimeout(() => {
      ref.current?.focus();
      ref.current?.select();
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  return (
    <input
      ref={ref}
      defaultValue={initial}
      maxLength={64}
      spellCheck={false}
      aria-label="탭 이름"
      className="bg-background border-ring min-w-0 flex-1 rounded-sm border px-1 text-xs outline-none"
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(e.currentTarget.value);
        else if (e.key === "Escape") finish(null);
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
    />
  );
}

interface TabMenuProps {
  tabId: string;
  /** Set for editor tabs: the file path (editor menu instead of terminal items). */
  editorPath?: string;
  locked: boolean;
  canCloseOthers: boolean;
  onRename: () => void;
  children: React.ReactNode;
}

/** Tab menu → "탭 테마": a theme for this terminal only (e.g. to make a production server stand out). */
function TabThemeMenu({ tabId }: { tabId: string }) {
  const tabTheme = useTabStore((s) => s.tabs.find((t) => t.id === tabId)?.theme);
  const globalTheme = useSettingsStore((s) => s.theme);
  const setTabTheme = useTabStore((s) => s.setTabTheme);
  const current = tabTheme ?? globalTheme;

  const swatch = (name: ThemeName) => {
    const t = THEMES[name].terminal;
    return (
      <span className="flex h-4 w-7 shrink-0 items-center justify-center gap-px rounded-sm border" style={{ background: THEMES[name].backdrop ?? t.background }}>
        {[t.red, t.green, t.blue].map((c, i) => (
          <span key={i} className="size-1.5 rounded-full" style={{ background: c }} />
        ))}
      </span>
    );
  };

  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <Palette />
        탭 테마
        <span className="text-muted-foreground ml-auto pl-3 text-xs">{tabTheme ? THEMES[tabTheme].label : "기본"}</span>
      </ContextMenuSubTrigger>
      <ContextMenuSubContent>
        <ContextMenuItem onSelect={() => setTabTheme(tabId, undefined)}>
          <Check className={cn(tabTheme && "invisible")} />
          {swatch(globalTheme)}
          기본 (설정 테마: {THEMES[globalTheme].label})
        </ContextMenuItem>
        <ContextMenuSeparator />
        {(Object.keys(THEMES) as ThemeName[]).map((name) => (
          <ContextMenuItem key={name} onSelect={() => setTabTheme(tabId, name)}>
            <Check className={cn((!tabTheme || current !== name) && "invisible")} />
            {swatch(name)}
            {THEMES[name].label}
          </ContextMenuItem>
        ))}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

/** Right-click menu of a tab. */
function TabMenu({ tabId, editorPath, locked, canCloseOthers, onRename, children }: TabMenuProps) {
  const { duplicateTab, reconnectTab, closeOtherTabs, closeTab, toggleLock, setActiveTab } = useTabStore.getState();
  // Only meaningful when closing a tab keeps it alive in session history.
  const keepsClosedTabs = useSettingsStore((s) => s.historyOnTabClose && s.historyKeepMinutes > 0);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent onCloseAutoFocus={(e) => e.preventDefault()}>
        <ContextMenuItem onSelect={onRename}>
          <Pencil />
          이름 변경
          <ContextMenuShortcut>더블클릭</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => toggleLock(tabId)}>
          {locked ? <LockOpen /> : <Lock />}
          {locked ? "잠금 해제" : "탭 잠금"}
        </ContextMenuItem>
        {editorPath === undefined && <TabThemeMenu tabId={tabId} />}
        <ContextMenuSeparator />
        {editorPath !== undefined ? (
          <>
            <ContextMenuItem onSelect={() => void editorRegistry.get(tabId)?.save()}>
              <Save />
              저장
              <ContextMenuShortcut>Ctrl+S</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => void navigator.clipboard.writeText(editorPath)}>
              <Copy />
              경로 복사
            </ContextMenuItem>
          </>
        ) : (
          <>
            <ContextMenuItem onSelect={() => void terminalRegistry.get(tabId)?.copyText("all")}>
              <ClipboardCopy />
              모든 텍스트 복사
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => void terminalRegistry.get(tabId)?.copyText("screen")}>
              <Monitor />
              보이는 화면 복사
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() => {
                setActiveTab(tabId);
                terminalRegistry.get(tabId)?.selectAll();
              }}
            >
              <TextSelect />
              모두 선택
              <ContextMenuShortcut>Ctrl+Shift+A</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => duplicateTab(tabId)}>
              <Copy />
              탭 복제
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => duplicateTab(tabId, "right")}>
              <Columns2 />
              오른쪽에 분할하여 복제
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => duplicateTab(tabId, "bottom")}>
              <Rows2 />
              아래에 분할하여 복제
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => reconnectTab(tabId)}>
              <RotateCw />
              다시 연결
            </ContextMenuItem>
          </>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem disabled={!canCloseOthers} onSelect={() => closeOtherTabs(tabId)}>
          <XSquare />
          다른 탭 닫기
        </ContextMenuItem>
        {keepsClosedTabs && (
          <ContextMenuItem disabled={locked} onSelect={() => closeTab(tabId, { keep: false })}>
            <X />
            닫기 (보관하지 않고 바로 종료)
          </ContextMenuItem>
        )}
        <ContextMenuItem variant="destructive" disabled={locked} onSelect={() => closeTab(tabId)}>
          <X />
          탭 닫기
          <ContextMenuShortcut>Ctrl+Shift+W</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** "+" in the tab bar: pick an SSH session or a local shell, in the sidebar's order. */
function NewTabMenu({ shells, onPick }: { shells: ShellInfo[]; onPick: (pick: NewTabPick) => void }) {
  const sessions = useSessionStore((s) => s.sessions);
  const shellOrder = useSettingsStore((s) => s.shellOrder);

  return (
    <DropdownMenu>
      <Hint label="새 탭 (SSH 세션 · 로컬 셸 선택)">
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="mb-0.5 ml-1 size-6 shrink-0 [&_svg]:size-3.5">
            <Plus />
          </Button>
        </DropdownMenuTrigger>
      </Hint>
      {/* No focus back to "+" on close: the new terminal should keep it. */}
      <DropdownMenuContent align="start" className="max-w-80" onCloseAutoFocus={(e) => e.preventDefault()}>
        <DropdownMenuLabel>SSH 세션</DropdownMenuLabel>
        {groupSessions(sessions).map(([group, items]) =>
          items.map((s) => (
            <DropdownMenuItem key={s.id} onSelect={() => onPick({ type: "ssh", session: s })}>
              <Server className="text-muted-foreground" />
              <span className="truncate">{s.name}</span>
              {group && <DropdownMenuShortcut className="max-w-28 truncate tracking-normal">{group}</DropdownMenuShortcut>}
            </DropdownMenuItem>
          )),
        )}
        <DropdownMenuItem onSelect={() => onPick({ type: "new-session" })}>
          <Plus className="text-muted-foreground" />
          <span className="text-muted-foreground">새 SSH 세션…</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>로컬 셸</DropdownMenuLabel>
        {orderShells(shells, shellOrder).map((sh) => (
          <DropdownMenuItem key={sh.command} onSelect={() => onPick({ type: "shell", shell: sh })}>
            <SquareTerminal className="text-muted-foreground" />
            <span className="truncate">{sh.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DropMarker() {
  return <span className="bg-primary pointer-events-none absolute inset-y-1 -left-px z-10 w-0.5 rounded" />;
}
