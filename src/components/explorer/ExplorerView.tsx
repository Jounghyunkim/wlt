import { useEffect, useMemo, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { downloadDir } from "@tauri-apps/api/path";
import {
  ArrowUp,
  ChevronRight,
  CopyMinus,
  ClipboardPaste,
  Copy,
  Download,
  ExternalLink,
  FilePlus,
  FolderOpen,
  FolderPlus,
  FolderSearch,
  FolderUp,
  Home,
  Link2,
  Pencil,
  RefreshCw,
  Scissors,
  SquareTerminal,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { ViewHeader } from "@/components/layout/ViewHeader";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Hint } from "@/components/ui/tooltip";
import { backend, isDesktop } from "@/lib/backend";
import { beginPointerDrag, registerDrop, useDnd } from "@/lib/dnd";
import { LOCAL, formatSize, fsApi, targetKey, type FsEntry, type FsTarget } from "@/lib/fs";
import { cn } from "@/lib/utils";
import { dirKey, useExplorerStore } from "@/store/explorerStore";
import { useSettingsStore } from "@/store/settingsStore";
import { connIdOf, selectActiveTabId, useTabStore } from "@/store/tabStore";
import { fileIcon } from "./fileIcon";
import { TransferList } from "./TransferList";

/**
 * Drop on a folder (`data-drop="fs-dir"`, folder in `data-drop-path`):
 * explorer items move there (Ctrl: copy); files from Windows Explorer are
 * uploaded (or copied, when the target is this PC).
 */
registerDrop("fs-dir", (payload, el, _x, _y, copy) => {
  const dir = el.dataset.dropPath;
  if (dir === undefined) return;
  const { target, startTransfer, setError } = useExplorerStore.getState();
  const run = (job: Promise<unknown>) =>
    job.catch((e) => {
      if (String(e) !== "cancelled") setError(String(e));
    });
  if (payload.kind === "os") {
    const verb = target.kind === "local" ? "복사" : "업로드";
    void run(
      startTransfer({
        label: `${payload.paths.length}개 항목 ${verb}`,
        src: LOCAL,
        paths: payload.paths,
        dst: target,
        dstDir: dir,
        mode: "copy",
      }),
    );
  } else if (payload.kind === "fs" && payload.targetKey === targetKey(target)) {
    const mode = copy ? "copy" : "move";
    void run(
      startTransfer({
        label: `${payload.paths.length}개 항목 ${mode === "move" ? "이동" : "복사"}`,
        src: target,
        paths: payload.paths,
        dst: target,
        dstDir: dir,
        mode,
      }),
    );
  }
});

type Row =
  | { kind: "entry"; entry: FsEntry; depth: number; parent: string }
  | { kind: "create"; parent: string; depth: number; isDir: boolean }
  | { kind: "status"; depth: number; text: string; error?: boolean; retry?: string };

interface TargetOption {
  key: string;
  target: FsTarget;
  label: string;
  tabId?: string;
}

/** Single-quotes a path for a POSIX shell. */
const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export function ExplorerView() {
  const tabs = useTabStore((s) => s.tabs);
  const activeTab = useTabStore((s) => {
    const id = selectActiveTabId(s);
    return id ? s.tabs.find((t) => t.id === id) : undefined;
  });
  const {
    target,
    roots,
    dirs,
    expanded,
    selection,
    cursor,
    clipboard,
    setTarget,
    setRoot,
    load,
    reload,
    toggle,
    collapseAll,
    select,
    setClipboard,
    startTransfer,
    editRemote,
    error,
    setError,
  } = useExplorerStore();

  const [renaming, setRenaming] = useState<string | null>(null);
  const [creating, setCreating] = useState<{ parent: string; isDir: boolean } | null>(null);
  const [menuRow, setMenuRow] = useState<Extract<Row, { kind: "entry" }> | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string[] | null>(null);
  const dropDir = useDnd((s) =>
    (s.payload?.kind === "fs" || s.payload?.kind === "os") && s.over?.dataset.drop === "fs-dir"
      ? (s.over.dataset.dropPath ?? null)
      : null,
  );
  const treeRef = useRef<HTMLDivElement>(null);

  const key = targetKey(target);
  const root = roots[key];
  const isLocal = target.kind === "local";

  // ── Targets: the local PC and every connected SSH tab ─────────────────────
  const options = useMemo<TargetOption[]>(
    () => [
      { key: "local", target: LOCAL, label: "로컬 PC" },
      ...tabs.flatMap((t) =>
        t.target.type === "ssh" && t.status === "connected" && !t.parkedAt
          ? [
              {
                key: `ssh:${connIdOf(t)}`,
                target: { kind: "ssh", connId: connIdOf(t) } as FsTarget,
                label: `${t.title} (${t.target.config.username}@${t.target.config.host})`,
                tabId: t.id,
              },
            ]
          : [],
      ),
    ],
    [tabs],
  );

  // Follow the focused tab, like VS Code follows the active editor.
  const followKey = activeTab ? `${activeTab.id}:${activeTab.generation}:${activeTab.status}` : "";
  useEffect(() => {
    if (!activeTab) return;
    if (activeTab.target.type === "local") setTarget(LOCAL);
    else if (activeTab.status === "connected") setTarget({ kind: "ssh", connId: connIdOf(activeTab) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followKey]);

  // The SSH tab behind the current target was closed or disconnected.
  useEffect(() => {
    if (!options.some((o) => o.key === key)) setTarget(LOCAL);
  }, [options, key, setTarget]);

  // Start at the home folder, then load the root.
  useEffect(() => {
    if (!isDesktop) return;
    if (root === undefined || root === "~" || root.startsWith("~/")) {
      // No root yet, or a shell-reported "~/dir" (title fallback): resolve against the home folder.
      fsApi
        .home(target)
        .then((home) => setRoot(root && root !== "~" ? `${home.replace(/\/$/, "")}/${root.slice(2)}` : home, target))
        .catch((e) => setError(String(e)));
    } else if (!useExplorerStore.getState().dirs[dirKey(target, root)]) {
      void load(root, target);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, root]);

  // Optional: follow the focused terminal's folder as you `cd` around.
  const follow = useSettingsStore((s) => s.explorerFollowTerminal);
  const activeCwd = activeTab?.cwd;
  useEffect(() => {
    if (!follow || !activeTab || !activeCwd) return;
    const tabTarget: FsTarget =
      activeTab.target.type === "local" ? LOCAL : { kind: "ssh", connId: connIdOf(activeTab) };
    if (targetKey(tabTarget) === key && activeCwd !== root) setRoot(activeCwd, tabTarget);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [follow, activeCwd, key]);

  // ── Visible rows ──────────────────────────────────────────────────────────
  const rows = useMemo(() => {
    const out: Row[] = [];
    if (root === undefined) return out;
    const walk = (dir: string, depth: number) => {
      if (creating?.parent === dir) out.push({ kind: "create", parent: dir, depth, isDir: creating.isDir });
      const state = dirs[dirKey(target, dir)];
      if (!state || (state.loading && !state.entries)) {
        out.push({ kind: "status", depth, text: "불러오는 중…" });
        return;
      }
      if (state.error) out.push({ kind: "status", depth, text: state.error, error: true, retry: dir });
      for (const entry of state.entries ?? []) {
        out.push({ kind: "entry", entry, depth, parent: dir });
        if (entry.isDir && expanded[dirKey(target, entry.path)]) walk(entry.path, depth + 1);
      }
      if (state.entries?.length === 0 && creating?.parent !== dir) out.push({ kind: "status", depth, text: "(비어 있음)" });
    };
    walk(root, 0);
    return out;
  }, [root, dirs, expanded, target, creating]);

  const entryRows = useMemo(
    () => rows.filter((r): r is Extract<Row, { kind: "entry" }> => r.kind === "entry"),
    [rows],
  );
  const rowOf = (path: string | null) => entryRows.find((r) => r.entry.path === path);

  // ── Operations ────────────────────────────────────────────────────────────
  const attempt = async (fn: () => Promise<unknown>) => {
    try {
      setError(null);
      await fn();
    } catch (e) {
      if (String(e) !== "cancelled") setError(String(e));
    }
  };

  /** Folder that "new" / "paste" / "upload" act on: the selected folder, a file's folder, or the root. */
  const contextDir = (row = rowOf(cursor)) => {
    if (!row) return root ?? "";
    if (row.entry.isDir) return row.entry.path;
    return row.parent;
  };

  const startCreate = (isDir: boolean, dir = contextDir()) => {
    if (dir !== root) toggle(dir, true);
    setRenaming(null);
    setCreating({ parent: dir, isDir });
  };

  const finishCreate = (name: string | null) => {
    const c = creating;
    setCreating(null);
    if (!c || !name?.trim()) return;
    void attempt(async () => {
      const path = await fsApi.create(target, c.parent, name.trim(), c.isDir);
      await load(c.parent);
      select([path]);
    });
  };

  const finishRename = (row: Extract<Row, { kind: "entry" }>, name: string | null) => {
    setRenaming(null);
    if (!name?.trim() || name.trim() === row.entry.name) return;
    void attempt(async () => {
      const path = await fsApi.rename(target, row.entry.path, name.trim());
      await load(row.parent);
      select([path]);
    });
  };

  const confirmDelete = () => {
    const paths = pendingDelete ?? [];
    setPendingDelete(null);
    void attempt(async () => {
      await fsApi.remove(target, paths);
      const parents = new Set(paths.map((p) => rowOf(p)?.parent).filter((p) => p !== undefined));
      await Promise.all([...parents].map((p) => load(p)));
      select([]);
    });
  };

  const copyToClipboard = (mode: "copy" | "move", paths = selection) => {
    if (paths.length) setClipboard({ target, paths, mode });
  };

  const paste = (dir = contextDir()) => {
    const cb = clipboard;
    if (!cb) return;
    const cross = targetKey(cb.target) !== key;
    const verb = cross ? (isLocal ? "다운로드" : "업로드") : cb.mode === "move" ? "이동" : "복사";
    void attempt(async () => {
      await startTransfer({
        label: `${cb.paths.length}개 항목 ${verb}`,
        src: cb.target,
        paths: cb.paths,
        dst: target,
        dstDir: dir,
        mode: cb.mode,
      });
      if (cb.mode === "move") setClipboard(null);
    });
  };

  const download = (paths = selection) =>
    attempt(async () => {
      if (!paths.length) return;
      const dir = await openDialog({ directory: true, defaultPath: await downloadDir(), title: "다운로드할 위치 선택" });
      if (typeof dir !== "string") return;
      await startTransfer({ label: `${paths.length}개 항목 다운로드`, src: target, paths, dst: LOCAL, dstDir: dir, mode: "copy" });
    });

  const upload = (folders: boolean, dir = contextDir()) =>
    attempt(async () => {
      const picked = await openDialog({
        multiple: true,
        directory: folders,
        title: folders ? "업로드할 폴더 선택" : "업로드할 파일 선택",
      });
      const paths = picked === null ? [] : Array.isArray(picked) ? picked : [picked];
      if (!paths.length) return;
      await startTransfer({ label: `${paths.length}개 항목 업로드`, src: LOCAL, paths, dst: target, dstDir: dir, mode: "copy" });
    });

  /** Local files open directly; remote files open as a synced copy that uploads on every save. */
  const openEntry = (entry: FsEntry) =>
    attempt(async () => {
      if (isLocal) return fsApi.open(entry.path);
      await editRemote(target, entry.path);
    });

  const openTerminalHere = (dir: string) =>
    attempt(async () => {
      const tabState = useTabStore.getState();
      if (target.kind === "local") {
        const name = dir.split(/[\\/]/).filter(Boolean).at(-1) ?? dir;
        tabState.openTab(name, { type: "local", cwd: dir });
        return;
      }
      const tab = tabState.tabs.find((t) => connIdOf(t) === target.connId);
      if (!tab) throw new Error("SSH 탭을 찾을 수 없습니다");
      await backend.write(target.connId, `cd ${shQuote(dir)}\r`);
      tabState.setActiveTab(tab.id);
    });

  const goUp = () =>
    attempt(async () => {
      if (root === undefined) return;
      const parent = await fsApi.parent(target, root);
      if (parent !== null) setRoot(parent);
    });

  const goHome = () => attempt(async () => setRoot(await fsApi.home(target)));

  const refresh = () =>
    attempt(async () => {
      if (root === undefined) return;
      // Reload the root and every expanded folder of this target.
      const prefix = `${key}|`;
      const open = Object.entries(expanded)
        .filter(([k, v]) => v && k.startsWith(prefix))
        .map(([k]) => k.slice(prefix.length));
      await Promise.all([root, ...open].map((p) => reload(target, p)));
    });

  // ── Selection & keyboard ──────────────────────────────────────────────────
  const scrollTo = (path: string) =>
    requestAnimationFrame(() =>
      treeRef.current?.querySelector(`[data-path="${CSS.escape(path)}"]`)?.scrollIntoView({ block: "nearest" }),
    );

  const onRowClick = (e: React.MouseEvent, row: Extract<Row, { kind: "entry" }>) => {
    const path = row.entry.path;
    if (e.ctrlKey || e.metaKey) {
      select(selection.includes(path) ? selection.filter((p) => p !== path) : [...selection, path], path);
      return;
    }
    if (e.shiftKey && cursor) {
      const a = entryRows.findIndex((r) => r.entry.path === cursor);
      const b = entryRows.findIndex((r) => r.entry.path === path);
      if (a >= 0 && b >= 0) {
        const [from, to] = a < b ? [a, b] : [b, a];
        select(entryRows.slice(from, to + 1).map((r) => r.entry.path), cursor);
        return;
      }
    }
    select([path]);
    if (row.entry.isDir) toggle(path);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (renaming || creating) return;
    const idx = entryRows.findIndex((r) => r.entry.path === cursor);
    const row = entryRows[idx];
    const move = (i: number) => {
      const next = entryRows[Math.max(0, Math.min(entryRows.length - 1, i))];
      if (next) {
        select([next.entry.path]);
        scrollTo(next.entry.path);
      }
    };
    const ctrl = e.ctrlKey || e.metaKey;
    let handled = true;
    if (e.key === "ArrowDown") move(idx + 1);
    else if (e.key === "ArrowUp") move(idx < 0 ? 0 : idx - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(entryRows.length - 1);
    else if (e.key === "ArrowRight" && row?.entry.isDir) {
      if (!expanded[dirKey(target, row.entry.path)]) toggle(row.entry.path, true);
      else move(idx + 1);
    } else if (e.key === "ArrowLeft" && row) {
      if (row.entry.isDir && expanded[dirKey(target, row.entry.path)]) toggle(row.entry.path, false);
      else if (rowOf(row.parent)) move(entryRows.findIndex((r) => r.entry.path === row.parent));
    } else if (e.key === "Enter" && row) {
      if (row.entry.isDir) toggle(row.entry.path);
      else void openEntry(row.entry);
    } else if (e.key === "F2" && row) setRenaming(row.entry.path);
    else if (e.key === "Delete" && selection.length) setPendingDelete(selection);
    else if (ctrl && e.code === "KeyC") copyToClipboard("copy");
    else if (ctrl && e.code === "KeyX") copyToClipboard("move");
    else if (ctrl && e.code === "KeyV") paste();
    else if (ctrl && e.code === "KeyA") select(entryRows.map((r) => r.entry.path), cursor);
    else if (e.key === "Escape") {
      if (clipboard?.mode === "move") setClipboard(null);
      select([]);
    } else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  // ── Drag & drop (move; Ctrl = copy) — drops are handled by the "fs-dir" handler above ──
  const onRowPointerDown = (e: React.PointerEvent, entry: FsEntry) => {
    if (renaming === entry.path) return;
    beginPointerDrag(e, () => {
      const paths = selection.includes(entry.path) ? selection : [entry.path];
      if (!selection.includes(entry.path)) select([entry.path]);
      return { kind: "fs", targetKey: key, paths, label: paths.length > 1 ? `${paths.length}개 항목` : entry.name };
    });
  };

  // ── Render ────────────────────────────────────────────────────────────────
  const remoteOnly = !isLocal;
  // Right-click on empty space (no row) acts on the root folder.
  const menuDir = menuRow ? contextDir(menuRow) : (root ?? "");
  const menuPaths = menuRow ? selection : [];

  return (
    <>
      <ViewHeader title="탐색기">
        <ToolbarButton label="새 파일" onClick={() => startCreate(false)}>
          <FilePlus />
        </ToolbarButton>
        <ToolbarButton label="새 폴더" onClick={() => startCreate(true)}>
          <FolderPlus />
        </ToolbarButton>
        {remoteOnly && (
          <ToolbarButton label="파일 업로드" onClick={() => void upload(false)}>
            <Upload />
          </ToolbarButton>
        )}
        <ToolbarButton label="새로 고침" onClick={() => void refresh()}>
          <RefreshCw />
        </ToolbarButton>
        <ToolbarButton label="모두 접기" onClick={collapseAll}>
          <CopyMinus />
        </ToolbarButton>
      </ViewHeader>

      <div className="grid gap-1.5 px-2 pb-2">
        <Select
          value={key}
          onValueChange={(v) => {
            const o = options.find((opt) => opt.key === v);
            if (o) setTarget(o.target);
          }}
        >
          <SelectTrigger className="h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.key} value={o.key} className="text-xs">
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex gap-1">
          <ToolbarButton label="상위 폴더" onClick={() => void goUp()}>
            <ArrowUp />
          </ToolbarButton>
          <ToolbarButton label="홈 폴더" onClick={() => void goHome()}>
            <Home />
          </ToolbarButton>
          <PathInput value={root ?? ""} placeholder={isLocal ? "내 PC (드라이브)" : "/"} onSubmit={(p) => setRoot(p)} />
        </div>
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive mx-2 mb-2 flex items-start gap-2 rounded-md px-2 py-1.5 text-xs">
          <span className="min-w-0 flex-1 break-words">{error}</span>
          <button onClick={() => setError(null)} aria-label="닫기">
            <X className="size-3.5" />
          </button>
        </div>
      )}

      <ContextMenu
        onOpenChange={(open) => {
          if (!open) setMenuRow(null);
        }}
      >
        <ContextMenuTrigger asChild>
          <div
            ref={treeRef}
            tabIndex={0}
            role="tree"
            aria-label="파일 탐색기"
            aria-multiselectable
            onKeyDown={onKeyDown}
            data-drop="fs-dir"
            data-drop-path={root}
            className={cn(
              "min-h-0 flex-1 overflow-auto pb-4 outline-none",
              dropDir === root && "bg-primary/5",
            )}
          >
            {rows.map((row, i) => {
              if (row.kind === "status") {
                return (
                  <div
                    key={`status-${i}`}
                    className={cn("py-1 pr-2 text-xs", row.error ? "text-destructive" : "text-muted-foreground")}
                    style={{ paddingLeft: indent(row.depth) + 18 }}
                  >
                    {row.text}
                    {row.retry !== undefined && (
                      <button className="text-primary ml-2 hover:underline" onClick={() => void load(row.retry!)}>
                        다시 시도
                      </button>
                    )}
                  </div>
                );
              }
              if (row.kind === "create") {
                const Icon = row.isDir ? FolderPlus : FilePlus;
                return (
                  <div key="create" className="flex h-6 items-center gap-1 pr-2" style={{ paddingLeft: indent(row.depth) + 16 }}>
                    <Icon className="text-muted-foreground size-4 shrink-0" />
                    <InlineInput initial="" placeholder={row.isDir ? "폴더 이름" : "파일 이름"} onDone={finishCreate} />
                  </div>
                );
              }
              const { entry } = row;
              const selected = selection.includes(entry.path);
              const isOpen = entry.isDir && !!expanded[dirKey(target, entry.path)];
              const cut = clipboard?.mode === "move" && targetKey(clipboard.target) === key && clipboard.paths.includes(entry.path);
              const Icon = fileIcon(entry, isOpen);
              const dropHere = entry.isDir ? entry.path : row.parent;
              return (
                <div
                  key={entry.path}
                  data-path={entry.path}
                  role="treeitem"
                  aria-selected={selected}
                  aria-expanded={entry.isDir ? isOpen : undefined}
                  data-drop="fs-dir"
                  data-drop-path={dropHere}
                  onPointerDown={(e) => onRowPointerDown(e, entry)}
                  onClick={(e) => onRowClick(e, row)}
                  onDoubleClick={() => !entry.isDir && void openEntry(entry)}
                  onContextMenu={() => {
                    if (!selection.includes(entry.path)) select([entry.path]);
                    setMenuRow(row);
                  }}
                  title={describe(entry)}
                  className={cn(
                    "flex h-6 cursor-default items-center gap-1 pr-2 text-[13px] select-none",
                    selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
                    cursor === entry.path && "ring-primary/60 ring-1 ring-inset",
                    dropDir === entry.path && entry.isDir && "bg-primary/20",
                    cut && "opacity-50",
                  )}
                  style={{ paddingLeft: indent(row.depth) }}
                >
                  <ChevronRight
                    className={cn(
                      "text-muted-foreground size-4 shrink-0 transition-transform",
                      !entry.isDir && "invisible",
                      isOpen && "rotate-90",
                    )}
                  />
                  <Icon className={cn("size-4 shrink-0", entry.isDir ? "text-primary" : "text-muted-foreground")} />
                  {renaming === entry.path ? (
                    <InlineInput initial={entry.name} onDone={(name) => finishRename(row, name)} />
                  ) : (
                    <span className={cn("min-w-0 flex-1 truncate", entry.isSymlink && "italic")}>{entry.name}</span>
                  )}
                  {entry.isSymlink && <Link2 className="text-muted-foreground size-3 shrink-0" />}
                </div>
              );
            })}
          </div>
        </ContextMenuTrigger>

        <ContextMenuContent onCloseAutoFocus={(e) => e.preventDefault()}>
          <ContextMenuItem onSelect={() => startCreate(false, menuDir)}>
            <FilePlus />새 파일
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => startCreate(true, menuDir)}>
            <FolderPlus />새 폴더
          </ContextMenuItem>
          <ContextMenuSeparator />
          {menuRow && !menuRow.entry.isDir && (
            <ContextMenuItem onSelect={() => void openEntry(menuRow.entry)}>
              <ExternalLink />
              {isLocal ? "열기" : "열기 (저장하면 서버에 자동 업로드)"}
            </ContextMenuItem>
          )}
          {menuRow?.entry.isDir && (
            <ContextMenuItem onSelect={() => setRoot(menuRow.entry.path)}>
              <FolderOpen />이 폴더를 루트로
            </ContextMenuItem>
          )}
          {isLocal && menuRow && (
            <ContextMenuItem onSelect={() => void fsApi.reveal(menuRow.entry.path).catch((e) => setError(String(e)))}>
              <FolderSearch />
              Windows 탐색기에서 보기
            </ContextMenuItem>
          )}
          <ContextMenuItem onSelect={() => void openTerminalHere(menuDir)}>
            <SquareTerminal />
            {isLocal ? "여기서 새 터미널 열기" : "터미널에서 이 폴더로 이동 (cd)"}
          </ContextMenuItem>
          {remoteOnly && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem disabled={!menuPaths.length} onSelect={() => void download(menuPaths)}>
                <Download />
                다운로드…
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => void upload(false, menuDir)}>
                <Upload />
                파일 업로드…
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => void upload(true, menuDir)}>
                <FolderUp />
                폴더 업로드…
              </ContextMenuItem>
            </>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem disabled={!menuPaths.length} onSelect={() => copyToClipboard("move", menuPaths)}>
            <Scissors />
            잘라내기
            <ContextMenuShortcut>Ctrl+X</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem disabled={!menuPaths.length} onSelect={() => copyToClipboard("copy", menuPaths)}>
            <Copy />
            복사
            <ContextMenuShortcut>Ctrl+C</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem disabled={!clipboard} onSelect={() => paste(menuDir)}>
            <ClipboardPaste />
            {clipboard && targetKey(clipboard.target) !== key
              ? isLocal
                ? "붙여넣기 (다운로드)"
                : "붙여넣기 (업로드)"
              : "붙여넣기"}
            <ContextMenuShortcut>Ctrl+V</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            disabled={!menuPaths.length}
            onSelect={() => void navigator.clipboard.writeText(menuPaths.join("\r\n"))}
          >
            <Copy />
            경로 복사
          </ContextMenuItem>
          <ContextMenuItem disabled={!menuRow} onSelect={() => menuRow && setRenaming(menuRow.entry.path)}>
            <Pencil />
            이름 바꾸기
            <ContextMenuShortcut>F2</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem
            variant="destructive"
            disabled={!menuPaths.length}
            onSelect={() => setPendingDelete(menuPaths)}
          >
            <Trash2 />
            삭제
            <ContextMenuShortcut>Delete</ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <TransferList />

      <Dialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{pendingDelete?.length ?? 0}개 항목을 삭제할까요?</DialogTitle>
            <DialogDescription>
              {isLocal
                ? "휴지통으로 이동합니다."
                : "서버에서 영구적으로 삭제되며 되돌릴 수 없습니다. 폴더는 안의 내용까지 모두 삭제됩니다."}
            </DialogDescription>
          </DialogHeader>
          <ul className="bg-muted max-h-40 overflow-auto rounded-md px-3 py-2 font-mono text-xs">
            {pendingDelete?.map((p) => (
              <li key={p} className="truncate">
                {p}
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingDelete(null)}>
              취소
            </Button>
            <Button variant="destructive" onClick={confirmDelete} autoFocus>
              {isLocal ? "휴지통으로 이동" : "영구 삭제"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

const indent = (depth: number) => 8 + depth * 12;

function describe(e: FsEntry): string {
  const parts = [e.path];
  if (!e.isDir) parts.push(formatSize(e.size));
  if (e.modified) parts.push(new Date(e.modified * 1000).toLocaleString());
  return parts.join("\n");
}

function ToolbarButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Hint label={label}>
      <Button variant="ghost" size="iconSm" className="size-6 shrink-0" onClick={onClick} aria-label={label}>
        {children}
      </Button>
    </Hint>
  );
}

/** Editable path; Enter navigates, Esc reverts. */
function PathInput({ value, placeholder, onSubmit }: { value: string; placeholder: string; onSubmit: (p: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <Input
      value={draft}
      placeholder={placeholder}
      spellCheck={false}
      title={value}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") onSubmit(draft.trim());
        else if (e.key === "Escape") setDraft(value);
      }}
      onBlur={() => setDraft(value)}
      className="h-6 min-w-0 flex-1 px-1.5 font-mono text-xs"
    />
  );
}

/** Name editor for create / rename: Enter or blur saves, Esc cancels (`null`). */
function InlineInput({
  initial,
  placeholder,
  onDone,
}: {
  initial: string;
  placeholder?: string;
  onDone: (name: string | null) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const finish = (v: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(v);
  };

  useEffect(() => {
    // Deferred so a closing context menu can't take the focus back.
    const timer = setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      // Like VS Code: select the name without its extension.
      const dot = initial.lastIndexOf(".");
      el.setSelectionRange(0, dot > 0 ? dot : initial.length);
    }, 0);
    return () => clearTimeout(timer);
  }, [initial]);

  return (
    <input
      ref={ref}
      defaultValue={initial}
      placeholder={placeholder}
      spellCheck={false}
      className="bg-background border-ring min-w-0 flex-1 rounded-sm border px-1 text-[13px] outline-none"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(e.currentTarget.value);
        else if (e.key === "Escape") finish(null);
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
    />
  );
}
