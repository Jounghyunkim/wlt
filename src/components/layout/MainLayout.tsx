import { useCallback, useEffect, useState } from "react";
import { Plus, Server, SquareTerminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { backend, isDesktop, type ShellInfo } from "@/lib/backend";
import { migrateSecrets, sessionLabel, useSessionStore, type SshSession } from "@/store/sessionStore";
import { selectActiveTabId, useTabStore, type SplitSide } from "@/store/tabStore";
import { PasswordDialog } from "./PasswordDialog";
import { SessionDialog } from "./SessionDialog";
import { SettingsDialog } from "./SettingsDialog";
import { Sidebar } from "./Sidebar";
import { Workspace } from "./Workspace";
import { ActivityBar, showSidebarView } from "./ActivityBar";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { DragGhost, listenOsFileDrop } from "@/lib/dnd";
import { useHistoryStore } from "@/store/historyStore";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/store/settingsStore";

const FALLBACK_SHELLS: ShellInfo[] = [
  { name: "Windows PowerShell", command: "powershell.exe -NoLogo" },
  { name: "Command Prompt", command: "cmd.exe" },
];

export function MainLayout() {
  const sidebarOpen = useTabStore((s) => s.sidebarOpen);
  const sidebarSide = useSettingsStore((s) => s.sidebarSide);
  const openTab = useTabStore((s) => s.openTab);
  const touchSession = useSessionStore((s) => s.touchSession);

  const [shells, setShells] = useState<ShellInfo[]>(FALLBACK_SHELLS);
  const [sessionDialog, setSessionDialog] = useState<{ open: boolean; session: SshSession | null }>({
    open: false,
    session: null,
  });
  const [passwordFor, setPasswordFor] = useState<SshSession | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    if (!isDesktop) return;
    backend
      .listShells()
      .then((list) => list.length && setShells(list))
      .catch((e) => console.error("list_shells failed", e));
  }, []);

  const openLocal = useCallback(
    (shell?: ShellInfo, split?: SplitSide) =>
      openTab(shell?.name ?? "Terminal", { type: "local", shell: shell?.command }, split),
    [openTab],
  );

  // Saved secrets are never read here: Rust fetches them from the Credential Manager via `sessionId`.
  const openSsh = useCallback(
    (session: SshSession, password?: string, passphrase?: string) => {
      touchSession(session.id);
      openTab(session.name, {
        type: "ssh",
        sessionId: session.id,
        config: {
          host: session.host,
          port: session.port,
          username: session.username,
          authMethod: session.authMethod,
          password,
          privateKeyPath: session.privateKeyPath,
          passphrase,
          sessionId: session.id,
          forwards: session.forwards,
        },
      });
    },
    [openTab, touchSession],
  );

  /** Connects, asking for the password first when none is saved or typed. */
  const connect = useCallback(
    (session: SshSession, password?: string, passphrase?: string) => {
      if (session.authMethod === "password" && !session.hasPassword && !password) setPasswordFor(session);
      else openSsh(session, password, passphrase);
    },
    [openSsh],
  );

  // Older versions kept "saved" passwords in plain text; move them to the Credential Manager.
  useEffect(() => {
    void migrateSecrets();
  }, []);

  useEffect(() => {
    if (!isDesktop) return;
    const unlisten = listenOsFileDrop();
    return () => void unlisten.then((f) => f());
  }, []);

  // Closing the app: open (and kept) tabs go into session history first.
  // Tauri waits for this handler, then destroys the window.
  useEffect(() => {
    if (!isDesktop) return;
    const unlisten = getCurrentWindow().onCloseRequested(async () => {
      await useHistoryStore.getState().recordAll().catch((e) => console.warn("history on exit failed", e));
    });
    return () => void unlisten.then((f) => f());
  }, []);

  // Global shortcuts. The terminal lets these key combos bubble up instead of consuming them.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey) return;
      const tabState = useTabStore.getState();
      let handled = true;
      const activeTabId = selectActiveTabId(tabState);
      if (e.code === "Tab") tabState.cycleTab(e.shiftKey ? -1 : 1);
      else if (e.shiftKey && e.code === "KeyT") openLocal();
      else if (e.shiftKey && e.code === "Backslash") openLocal(undefined, "right");
      else if (e.shiftKey && e.code === "KeyW") activeTabId && tabState.closeTab(activeTabId);
      else if (e.shiftKey && e.code === "KeyB") tabState.toggleSidebar();
      else if (e.shiftKey && e.code === "KeyE") showSidebarView("explorer");
      else if (e.shiftKey && e.code === "KeyH") showSidebarView("history");
      else handled = false;
      if (handled) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openLocal]);

  return (
    <TooltipProvider>
      {/* Activity bar on the outer edge, then the sidebar, then the terminals (mirrored on the right). */}
      <div className={cn("flex h-full w-full", sidebarSide === "right" && "flex-row-reverse")}>
        <ActivityBar onOpenSettings={() => setSettingsOpen(true)} />
        {sidebarOpen && (
          <Sidebar
            shells={shells}
            onOpenShell={openLocal}
            onConnect={connect}
            onNewSession={() => setSessionDialog({ open: true, session: null })}
            onEditSession={(session) => setSessionDialog({ open: true, session })}
          />
        )}

        <main className="flex min-w-0 flex-1">
          <Workspace
            onNewTab={() => openLocal()}
            onSplitRight={() => openLocal(undefined, "right")}
            emptyState={
              <EmptyState
                onLocal={() => openLocal()}
                onNewSession={() => setSessionDialog({ open: true, session: null })}
              />
            }
          />
        </main>
      </div>

      <SessionDialog
        open={sessionDialog.open}
        session={sessionDialog.session}
        onOpenChange={(open) => setSessionDialog((d) => ({ ...d, open }))}
        onConnect={connect}
      />
      <PasswordDialog
        session={passwordFor}
        onCancel={() => setPasswordFor(null)}
        onSubmit={(password, save) => {
          const session = passwordFor;
          setPasswordFor(null);
          if (!session) return;
          openSsh(session, password);
          if (save && isDesktop) {
            backend
              .credentialSet(session.id, "password", password, sessionLabel(session))
              .then(() => useSessionStore.getState().updateSession(session.id, { hasPassword: true }))
              .catch((e) => console.warn("could not save password", e));
          }
        }}
      />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} shells={shells} />
      <DragGhost />
    </TooltipProvider>
  );
}

function EmptyState({ onLocal, onNewSession }: { onLocal: () => void; onNewSession: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-8 text-center">
      <SquareTerminal className="text-primary size-12" strokeWidth={1.5} />
      <div>
        <h1 className="text-xl font-semibold">WLT Terminal</h1>
        <p className="text-muted-foreground mt-1 text-sm">로컬 셸을 열거나 사이드바의 SSH 세션을 더블클릭하세요.</p>
      </div>
      <div className="flex gap-2">
        <Button onClick={onLocal}>
          <SquareTerminal />
          로컬 터미널
        </Button>
        <Button variant="secondary" onClick={onNewSession}>
          <Plus />
          <Server />
          새 SSH 세션
        </Button>
      </div>
      <dl className="text-muted-foreground grid grid-cols-[auto_auto] gap-x-6 gap-y-1 text-left text-xs">
        {[
          ["Ctrl+Shift+T", "새 로컬 탭"],
          ["Ctrl+Shift+W", "탭 닫기"],
          ["Ctrl+Tab", "다음 탭"],
          ["Ctrl+Shift+\\", "오른쪽에 터미널 분할"],
          ["Ctrl+Shift+E", "파일 탐색기"],
          ["Ctrl+Shift+H", "세션 히스토리"],
          ["탭 드래그 → 가장자리", "화면 분할"],
          ["Ctrl+Shift+F", "터미널 검색"],
          ["Ctrl+Shift+C / V", "복사 / 붙여넣기"],
          ["우클릭", "선택 복사 · 붙여넣기"],
          ["Ctrl + = / - / 0", "글꼴 크기"],
          ["Ctrl + 스크롤", "현재 탭만 글꼴 크기"],
        ].map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="font-mono">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="text-muted-foreground text-xs">Made by JohnnyStudio</p>
    </div>
  );
}
