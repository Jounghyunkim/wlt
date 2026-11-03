import { create } from "zustand";
import { persist } from "zustand/middleware";
import { backend, isDesktop } from "@/lib/backend";
import { LOCAL, type FsTarget } from "@/lib/fs";
import { terminalRegistry } from "@/lib/terminalRegistry";
import { newId } from "@/lib/utils";
import { useExplorerStore } from "@/store/explorerStore";
import { useSettingsStore } from "@/store/settingsStore";
import {
  connIdOf,
  onTabClose,
  useTabStore,
  type SplitSide,
  type TabTarget,
  type TerminalTab,
} from "@/store/tabStore";

/** A closed tab in session history. */
export interface HistoryEntry {
  id: string;
  title: string;
  /** SSH targets are stored without typed secrets (saved ones live in the Credential Manager). */
  target: TabTarget;
  /** Last folder the shell reported. */
  cwd?: string;
  closedAt: number;
  fontSize?: number;
  /** A screen snapshot file exists (history.rs). */
  hasSnapshot: boolean;
  /** Set while the tab is kept alive (parked): returning to it is instant. Memory only. */
  parkedTabId?: string;
}

interface HistoryState {
  entries: HistoryEntry[];
  /** Returns to an entry: the live tab if it's still parked, otherwise a new connection in its folder. */
  restore: (id: string, opts?: { split?: SplitSide; fresh?: boolean }) => void;
  remove: (id: string) => void;
  clear: () => void;
  /** Ends a parked tab now; the entry stays as a reconnect entry. */
  release: (id: string) => Promise<void>;
  /** Records every open tab (app is closing). */
  recordAll: () => Promise<void>;
}

const sameTarget = (a: TabTarget, b: TabTarget) =>
  a.type === "local" && b.type === "local"
    ? (a.shell ?? "") === (b.shell ?? "")
    : a.type === "ssh" && b.type === "ssh" && a.sessionId === b.sessionId;

function stripSecrets(target: TabTarget): TabTarget {
  if (target.type === "local") return { type: "local", shell: target.shell };
  if (target.type !== "ssh") return target;
  const { password: _p, passphrase: _pp, ...config } = target.config;
  return { ...target, config };
}

/** Saves the tab's screen (with colors) for a later reconnect; false if disabled or failed. */
async function saveSnapshot(entryId: string, tabId: string): Promise<boolean> {
  const lines = useSettingsStore.getState().historySnapshotLines;
  const data = lines > 0 ? terminalRegistry.get(tabId)?.serialize(lines) : undefined;
  if (!isDesktop || !data?.trim()) return false;
  try {
    await backend.historySaveSnapshot(entryId, data);
    return true;
  } catch (e) {
    console.warn("snapshot save failed", e);
    return false;
  }
}

/** Points the explorer at a tab's folder (shown next time the explorer is open). */
function syncExplorer(tab: Pick<TerminalTab, "id" | "generation" | "target">, cwd: string | undefined) {
  if (!cwd) return;
  const target: FsTarget = tab.target.type === "local" ? LOCAL : { kind: "ssh", connId: connIdOf(tab) };
  const explorer = useExplorerStore.getState();
  explorer.setRoot(cwd, target);
  explorer.setTarget(target);
}

export const useHistoryStore = create<HistoryState>()(
  persist(
    (set, get) => ({
      entries: [],

      restore: (id, opts) => {
        const entry = get().entries.find((e) => e.id === id);
        if (!entry) return;
        const tabs = useTabStore.getState();
        const parked = entry.parkedTabId ? tabs.tabs.find((t) => t.id === entry.parkedTabId && t.parkedAt) : undefined;
        if (parked && opts?.fresh) {
          // "New connection" for a live entry: end the kept tab (saving its screen), then reconnect.
          void get()
            .release(id)
            .then(() => get().restore(id, { split: opts.split }));
          return;
        }
        set((s) => ({ entries: s.entries.filter((e) => e.id !== id) }));

        if (parked) {
          // Live return: the very same terminal and connection.
          tabs.unparkTab(parked.id, opts?.split);
          syncExplorer(parked, parked.cwd ?? entry.cwd);
          if (isDesktop && entry.hasSnapshot) void backend.historyDeleteSnapshots([entry.id], false);
          return;
        }

        // Reconnect: same shell / server, back in the last folder, previous screen shown first.
        const target: TabTarget = entry.target.type === "local" ? { ...entry.target, cwd: entry.cwd } : entry.target;
        const tabId = tabs.openTab(entry.title, target, opts?.split, {
          fontSize: entry.fontSize,
          restore: {
            snapshotId: entry.hasSnapshot ? entry.id : undefined,
            snapshotAt: entry.closedAt,
            cwd: entry.target.type === "ssh" ? entry.cwd : undefined,
          },
        });
        const tab = useTabStore.getState().tabs.find((t) => t.id === tabId);
        if (tab) syncExplorer(tab, entry.cwd);
      },

      remove: (id) => {
        const entry = get().entries.find((e) => e.id === id);
        set((s) => ({ entries: s.entries.filter((e) => e.id !== id) }));
        if (entry?.parkedTabId) useTabStore.getState().disposeTab(entry.parkedTabId);
        if (isDesktop && entry?.hasSnapshot) void backend.historyDeleteSnapshots([id], false);
      },

      clear: () => {
        const { entries } = get();
        set({ entries: [] });
        for (const e of entries) if (e.parkedTabId) useTabStore.getState().disposeTab(e.parkedTabId);
        if (isDesktop) void backend.historyDeleteSnapshots([], true);
      },

      release: async (id) => {
        const entry = get().entries.find((e) => e.id === id);
        if (!entry?.parkedTabId) return;
        const tabId = entry.parkedTabId;
        // Re-snapshot: the screen may have changed while parked.
        const hasSnapshot = (await saveSnapshot(entry.id, tabId)) || entry.hasSnapshot;
        const cwd = useTabStore.getState().tabs.find((t) => t.id === tabId)?.cwd ?? entry.cwd;
        set((s) => ({
          entries: s.entries.map((e) => (e.id === id ? { ...e, parkedTabId: undefined, hasSnapshot, cwd } : e)),
        }));
        useTabStore.getState().disposeTab(tabId);
      },

      recordAll: async () => {
        const { tabs } = useTabStore.getState();
        // Parked tabs die with the app: snapshot them as reconnect entries.
        await Promise.all(get().entries.filter((e) => e.parkedTabId).map((e) => get().release(e.id)));
        await Promise.all(tabs.filter((t) => !t.parkedAt).map((t) => record(t, false)));
      },
    }),
    {
      name: "wlt.history",
      version: 1,
      // Parked tabs only exist in this run.
      partialize: (s) => ({ entries: s.entries.map(({ parkedTabId: _p, ...e }) => e) }),
    },
  ),
);

/** Adds a closing tab to the top of the history (merging an older entry for the same place). */
async function record(tab: TerminalTab, parked: boolean) {
  if (tab.target.type === "editor") return; // files reopen from the explorer, not from history
  const settings = useSettingsStore.getState();
  const id = newId();
  const entry: HistoryEntry = {
    id,
    title: tab.title,
    target: stripSecrets(tab.target),
    cwd: tab.cwd ?? (tab.target.type === "local" ? tab.target.cwd : tab.restore?.cwd),
    closedAt: Date.now(),
    fontSize: terminalRegistry.get(tab.id)?.fontSize() ?? undefined,
    hasSnapshot: false,
    parkedTabId: parked ? tab.id : undefined,
  };
  const { entries } = useHistoryStore.getState();
  // Same shell/server in the same folder → keep one entry (a live one wins over this record).
  const dupes = entries.filter((e) => !e.parkedTabId && sameTarget(e.target, entry.target) && e.cwd === entry.cwd);
  const kept = entries.filter((e) => !dupes.includes(e));
  const all = [entry, ...kept];
  const trimmed = all.slice(0, Math.max(1, settings.historyMaxEntries));
  const dropped = [...dupes, ...all.slice(trimmed.length)];
  useHistoryStore.setState({ entries: trimmed });
  for (const e of dropped) if (e.parkedTabId) useTabStore.getState().disposeTab(e.parkedTabId);
  if (isDesktop && dropped.some((e) => e.hasSnapshot)) {
    void backend.historyDeleteSnapshots(dropped.filter((e) => e.hasSnapshot).map((e) => e.id), false);
  }

  // Parked tabs keep their screen live; only a really-closed tab needs its screen saved now.
  if (!parked && (await saveSnapshot(id, tab.id))) {
    useHistoryStore.setState((s) => ({ entries: s.entries.map((e) => (e.id === id ? { ...e, hasSnapshot: true } : e)) }));
  }
  enforceKeepLimits();
}

/** Parked tabs past the time or count limit, or whose session ended, become reconnect entries. */
function enforceKeepLimits() {
  const { historyKeepMinutes, historyKeepMax } = useSettingsStore.getState();
  const { entries, release } = useHistoryStore.getState();
  const { tabs } = useTabStore.getState();
  const live = entries.filter((e) => e.parkedTabId); // newest first
  const now = Date.now();
  live.forEach((e, i) => {
    const tab = tabs.find((t) => t.id === e.parkedTabId);
    const expired = now - e.closedAt > historyKeepMinutes * 60_000;
    if (!tab || tab.status !== "connected" || expired || i >= historyKeepMax) void release(e.id);
  });
}

onTabClose((tab, parked) => void record(tab, parked));
setInterval(enforceKeepLimits, 30_000);
