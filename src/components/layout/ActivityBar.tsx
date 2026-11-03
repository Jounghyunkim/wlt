import { Files, History, ScreenShare, Search, Settings, type LucideIcon } from "lucide-react";
import { JohnnyMark } from "@/components/Brand";
import { Hint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useSettingsStore, type SidebarView } from "@/store/settingsStore";
import { useTabStore } from "@/store/tabStore";

const VIEWS: { view: SidebarView; icon: LucideIcon; label: string }[] = [
  { view: "terminals", icon: ScreenShare, label: "터미널 (Ctrl+Shift+B)" },
  { view: "explorer", icon: Files, label: "탐색기 (Ctrl+Shift+E)" },
  { view: "history", icon: History, label: "세션 히스토리 (Ctrl+Shift+H)" },
  { view: "search", icon: Search, label: "파일 내용 검색 (Ctrl+Shift+G)" },
];

/** Shows `view`, or hides the sidebar when that view is already showing (VS Code behaviour). */
export function showSidebarView(view: SidebarView) {
  const { sidebarOpen, toggleSidebar } = useTabStore.getState();
  const { sidebarView, update } = useSettingsStore.getState();
  if (sidebarOpen && sidebarView === view) {
    toggleSidebar();
    return;
  }
  update({ sidebarView: view });
  if (!sidebarOpen) toggleSidebar();
}

/** VS Code style icon strip on the outer edge of the window. */
export function ActivityBar({ onOpenSettings, onOpenAbout }: { onOpenSettings: () => void; onOpenAbout: () => void }) {
  const sidebarOpen = useTabStore((s) => s.sidebarOpen);
  const sidebarView = useSettingsStore((s) => s.sidebarView);
  const side = useSettingsStore((s) => s.sidebarSide);
  const tooltipSide = side === "left" ? "right" : "left";
  /** Closed tabs still alive for an instant return. */
  const parked = useTabStore((s) => s.tabs.filter((t) => t.parkedAt).length);

  return (
    <nav
      aria-label="작업 표시줄"
      className={cn("bg-sidebar flex w-12 shrink-0 flex-col items-center", side === "left" ? "border-r" : "border-l")}
    >
      {VIEWS.map(({ view, icon: Icon, label }) => {
        const active = sidebarOpen && sidebarView === view;
        return (
          <Hint key={view} label={label} side={tooltipSide}>
            <button
              aria-label={label}
              aria-pressed={active}
              onClick={() => showSidebarView(view)}
              className={cn(
                "relative flex size-12 items-center justify-center transition-colors",
                active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {active && (
                <span
                  className={cn("bg-primary absolute inset-y-2 w-0.5 rounded", side === "left" ? "left-0" : "right-0")}
                />
              )}
              <Icon className="size-6" strokeWidth={1.5} />
              {view === "history" && parked > 0 && (
                <span className="bg-success text-background absolute right-1.5 bottom-1.5 min-w-4 rounded-full px-1 text-center text-[10px] leading-4 font-semibold">
                  {parked}
                </span>
              )}
            </button>
          </Hint>
        );
      })}

      <div className="flex-1" />

      <Hint label="WLT · JohnnyStudio 정보" side={tooltipSide}>
        <button
          aria-label="WLT · JohnnyStudio 정보"
          onClick={onOpenAbout}
          className="text-muted-foreground hover:text-foreground flex size-12 items-center justify-center transition-colors"
        >
          <JohnnyMark icon className="h-5 w-7" />
        </button>
      </Hint>

      <Hint label="설정" side={tooltipSide}>
        <button
          aria-label="설정"
          onClick={onOpenSettings}
          className="text-muted-foreground hover:text-foreground flex size-12 items-center justify-center transition-colors"
        >
          <Settings className="size-6" strokeWidth={1.5} />
        </button>
      </Hint>
    </nav>
  );
}
