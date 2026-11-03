import { create } from "zustand";
import type { SshConnectConfig } from "@/lib/backend";
import { newId } from "@/lib/utils";
import { useSettingsStore } from "@/store/settingsStore";

export type TabStatus = "connecting" | "connected" | "closed" | "error";

export type TabTarget =
  | { type: "local"; shell?: string; cwd?: string }
  | { type: "ssh"; sessionId: string; config: SshConnectConfig };

export interface TerminalTab {
  /** Also used as the backend terminal id. */
  id: string;
  title: string;
  target: TabTarget;
  status: TabStatus;
  /** Incremented to force the terminal component to reconnect. */
  generation: number;
  /** Locked tabs can't be closed until unlocked. */
  locked: boolean;
  /** Last folder the shell reported (shell integration); see lib/cwd.ts. */
  cwd?: string;
  /**
   * Set while a closed tab is kept alive for session history: it is in no
   * group (so not on screen) but its terminal and connection keep running.
   */
  parkedAt?: number;
  /** Per-tab font size to start with (restored from history). */
  fontSize?: number;
  /** Restored from history: previous screen to show, folder to `cd` to over SSH. */
  restore?: { snapshotId?: string; snapshotAt?: number; cwd?: string };
}

type CloseHook = (tab: TerminalTab, parked: boolean) => void;
const closeHooks = new Set<CloseHook>();

/** Runs before a tab is closed (while its terminal is still mounted). */
export function onTabClose(hook: CloseHook) {
  closeHooks.add(hook);
}

/** Closed tabs are kept alive when history keeping is on and they're still connected. */
export function willPark(tab: TerminalTab): boolean {
  const { historyOnTabClose, historyKeepMinutes } = useSettingsStore.getState();
  return historyOnTabClose && historyKeepMinutes > 0 && tab.status === "connected";
}

/** Backend session id of the tab's current connection; changes on every reconnect. */
export function connIdOf(tab: Pick<TerminalTab, "id" | "generation">): string {
  return `${tab.id}-${tab.generation}`;
}

/** A pane with its own tab strip (VS Code "editor group"). */
export interface TabGroup {
  id: string;
  tabIds: string[];
  activeTabId: string | null;
}

export type SplitSide = "left" | "right" | "top" | "bottom";

/** Binary split tree whose leaves are tab groups. */
export type LayoutNode =
  | { type: "group"; groupId: string }
  | {
      type: "split";
      id: string;
      /** "row" = side by side, "column" = stacked. */
      direction: "row" | "column";
      /** Share of the space taken by `first` (0..1). */
      ratio: number;
      first: LayoutNode;
      second: LayoutNode;
    };

// ── Pure layout helpers ─────────────────────────────────────────────────────

/** Replaces the leaf of `groupId` with `fn(leaf)`. */
function mapLeaf(node: LayoutNode, groupId: string, fn: (leaf: LayoutNode) => LayoutNode): LayoutNode {
  if (node.type === "group") return node.groupId === groupId ? fn(node) : node;
  const first = mapLeaf(node.first, groupId, fn);
  const second = mapLeaf(node.second, groupId, fn);
  return first === node.first && second === node.second ? node : { ...node, first, second };
}

/** Removes the leaf of `groupId`; its sibling takes the parent split's place. */
function removeLeaf(node: LayoutNode, groupId: string): LayoutNode | null {
  if (node.type === "group") return node.groupId === groupId ? null : node;
  const first = removeLeaf(node.first, groupId);
  const second = removeLeaf(node.second, groupId);
  if (!first) return second;
  if (!second) return first;
  return first === node.first && second === node.second ? node : { ...node, first, second };
}

export function firstGroupId(node: LayoutNode): string {
  return node.type === "group" ? node.groupId : firstGroupId(node.first);
}

function setSplitRatio(node: LayoutNode, splitId: string, ratio: number): LayoutNode {
  if (node.type === "group") return node;
  if (node.id === splitId) return { ...node, ratio };
  const first = setSplitRatio(node.first, splitId, ratio);
  const second = setSplitRatio(node.second, splitId, ratio);
  return first === node.first && second === node.second ? node : { ...node, first, second };
}

function splitLeaf(layout: LayoutNode, targetGroupId: string, side: SplitSide, newGroupId: string): LayoutNode {
  return mapLeaf(layout, targetGroupId, (leaf) => {
    const added: LayoutNode = { type: "group", groupId: newGroupId };
    const before = side === "left" || side === "top";
    return {
      type: "split",
      id: newId(),
      direction: side === "left" || side === "right" ? "row" : "column",
      ratio: 0.5,
      first: before ? added : leaf,
      second: before ? leaf : added,
    };
  });
}

// ── Store ───────────────────────────────────────────────────────────────────

type Snapshot = Pick<TabState, "tabs" | "groups" | "layout" | "focusedGroupId">;

/** Takes `tabId` out of its group, picking the neighbouring tab as the new active one. */
function detachTab(groups: Record<string, TabGroup>, tabId: string): Record<string, TabGroup> {
  const group = Object.values(groups).find((g) => g.tabIds.includes(tabId));
  if (!group) return groups;
  const idx = group.tabIds.indexOf(tabId);
  const tabIds = group.tabIds.filter((id) => id !== tabId);
  const activeTabId =
    group.activeTabId === tabId ? (tabIds[Math.min(idx, tabIds.length - 1)] ?? null) : group.activeTabId;
  return { ...groups, [group.id]: { ...group, tabIds, activeTabId } };
}

/** Drops empty groups from the layout, always keeping at least one group. */
function pruneEmptyGroups(s: Snapshot): Snapshot {
  let { groups, layout, focusedGroupId } = s;
  for (const g of Object.values(groups)) {
    if (g.tabIds.length || Object.keys(groups).length === 1) continue;
    const next = removeLeaf(layout, g.id);
    if (!next) continue;
    layout = next;
    const { [g.id]: _removed, ...rest } = groups;
    groups = rest;
  }
  if (!groups[focusedGroupId]) focusedGroupId = firstGroupId(layout);
  return { ...s, groups, layout, focusedGroupId };
}

export function groupOfTab(groups: Record<string, TabGroup>, tabId: string): TabGroup | undefined {
  return Object.values(groups).find((g) => g.tabIds.includes(tabId));
}

/** Active tab of the focused group: the target of keyboard shortcuts. */
export function selectActiveTabId(s: TabState): string | null {
  return s.groups[s.focusedGroupId]?.activeTabId ?? null;
}

interface TabState {
  tabs: TerminalTab[];
  groups: Record<string, TabGroup>;
  layout: LayoutNode;
  focusedGroupId: string;
  sidebarOpen: boolean;
  /** Opens a tab in the focused group, or in a new group split off on `split`. */
  openTab: (
    title: string,
    target: TabTarget,
    split?: SplitSide,
    extra?: Pick<TerminalTab, "fontSize" | "restore">,
  ) => string;
  /** Opens a new session to the same target, next to the tab or in a new group on `split`. */
  duplicateTab: (id: string, split?: SplitSide) => void;
  /**
   * Closes a tab. Only with "history on tab close" enabled is it recorded in
   * session history and, when possible, kept alive (parked) for an instant
   * return; `keep: false` then ends it right away.
   */
  closeTab: (id: string, opts?: { keep?: boolean }) => void;
  /** Really ends a tab (process / connection), parked or not. No history entry. */
  disposeTab: (id: string) => void;
  /** Puts a parked tab back on screen, in the focused group or a new split. */
  unparkTab: (id: string, split?: SplitSide) => void;
  setCwd: (id: string, cwd: string) => void;
  /** Closes every other unlocked tab in the tab's group. */
  closeOtherTabs: (id: string) => void;
  toggleLock: (id: string) => void;
  setActiveTab: (id: string) => void;
  focusGroup: (groupId: string) => void;
  cycleTab: (dir: 1 | -1) => void;
  /** Moves a tab into `groupId` before `beforeTabId` (or to the end). */
  moveTab: (tabId: string, groupId: string, beforeTabId?: string) => void;
  /** Moves a tab into a new group created on `side` of `targetGroupId`. */
  splitTab: (tabId: string, targetGroupId: string, side: SplitSide) => void;
  setSplitRatio: (splitId: string, ratio: number) => void;
  setStatus: (id: string, status: TabStatus) => void;
  renameTab: (id: string, title: string) => void;
  reconnectTab: (id: string) => void;
  toggleSidebar: () => void;
}

const initialGroupId = newId();

export const useTabStore = create<TabState>()((set, get) => ({
  tabs: [],
  groups: { [initialGroupId]: { id: initialGroupId, tabIds: [], activeTabId: null } },
  layout: { type: "group", groupId: initialGroupId },
  focusedGroupId: initialGroupId,
  sidebarOpen: true,

  openTab: (title, target, split, extra) => {
    const tab: TerminalTab = { id: newId(), title, target, status: "connecting", generation: 0, locked: false, ...extra };
    set((s) => {
      const focused = s.groups[s.focusedGroupId];
      // Splitting an empty group would leave an empty pane behind, so just open in place.
      if (split && focused.tabIds.length) {
        const group: TabGroup = { id: newId(), tabIds: [tab.id], activeTabId: tab.id };
        return {
          tabs: [...s.tabs, tab],
          groups: { ...s.groups, [group.id]: group },
          layout: splitLeaf(s.layout, focused.id, split, group.id),
          focusedGroupId: group.id,
        };
      }
      return {
        tabs: [...s.tabs, tab],
        groups: {
          ...s.groups,
          [focused.id]: { ...focused, tabIds: [...focused.tabIds, tab.id], activeTabId: tab.id },
        },
      };
    });
    return tab.id;
  },

  duplicateTab: (id, split) =>
    set((s) => {
      const source = s.tabs.find((t) => t.id === id);
      const group = groupOfTab(s.groups, id);
      if (!source || !group) return s;
      const tab: TerminalTab = {
        ...source,
        id: newId(),
        status: "connecting",
        generation: 0,
        locked: false,
        restore: undefined,
        // A local duplicate starts where the original currently is.
        target: source.target.type === "local" && source.cwd ? { ...source.target, cwd: source.cwd } : source.target,
      };
      const tabs = [...s.tabs, tab];
      if (split) {
        const added: TabGroup = { id: newId(), tabIds: [tab.id], activeTabId: tab.id };
        return {
          tabs,
          groups: { ...s.groups, [added.id]: added },
          layout: splitLeaf(s.layout, group.id, split, added.id),
          focusedGroupId: added.id,
        };
      }
      const tabIds = [...group.tabIds];
      tabIds.splice(tabIds.indexOf(id) + 1, 0, tab.id);
      return {
        tabs,
        groups: { ...s.groups, [group.id]: { ...group, tabIds, activeTabId: tab.id } },
        focusedGroupId: group.id,
      };
    }),

  closeTab: (id, opts) => {
    const tab = get().tabs.find((t) => t.id === id);
    if (!tab || tab.locked || tab.parkedAt) return;
    const park = opts?.keep !== false && willPark(tab);
    // By default a tab the user closes is simply gone; history is filled when the app quits.
    if (useSettingsStore.getState().historyOnTabClose) closeHooks.forEach((hook) => hook(tab, park));
    set((s) =>
      pruneEmptyGroups({
        ...s,
        // A parked tab stays in `tabs` (terminal + connection alive) but leaves every group.
        tabs: park ? s.tabs.map((t) => (t.id === id ? { ...t, parkedAt: Date.now() } : t)) : s.tabs.filter((t) => t.id !== id),
        groups: detachTab(s.groups, id),
      }),
    );
  },

  disposeTab: (id) =>
    set((s) =>
      pruneEmptyGroups({
        ...s,
        tabs: s.tabs.filter((t) => t.id !== id),
        groups: detachTab(s.groups, id),
      }),
    ),

  unparkTab: (id, split) =>
    set((s) => {
      const tab = s.tabs.find((t) => t.id === id);
      if (!tab?.parkedAt) return s;
      const tabs = s.tabs.map((t) => (t.id === id ? { ...t, parkedAt: undefined } : t));
      const focused = s.groups[s.focusedGroupId];
      if (split && focused.tabIds.length) {
        const group: TabGroup = { id: newId(), tabIds: [id], activeTabId: id };
        return {
          tabs,
          groups: { ...s.groups, [group.id]: group },
          layout: splitLeaf(s.layout, focused.id, split, group.id),
          focusedGroupId: group.id,
        };
      }
      return {
        tabs,
        groups: { ...s.groups, [focused.id]: { ...focused, tabIds: [...focused.tabIds, id], activeTabId: id } },
      };
    }),

  setCwd: (id, cwd) => {
    if (get().tabs.find((t) => t.id === id)?.cwd === cwd) return;
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, cwd } : t)) }));
  },

  closeOtherTabs: (id) => {
    const group = groupOfTab(get().groups, id);
    if (!group) return;
    // One by one so each goes through history (locked tabs are skipped by closeTab).
    for (const other of group.tabIds.filter((t) => t !== id)) get().closeTab(other);
    get().setActiveTab(id);
  },

  toggleLock: (id) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, locked: !t.locked } : t)) })),

  setActiveTab: (id) =>
    set((s) => {
      const group = groupOfTab(s.groups, id);
      if (!group) return s;
      return { groups: { ...s.groups, [group.id]: { ...group, activeTabId: id } }, focusedGroupId: group.id };
    }),

  focusGroup: (groupId) => {
    if (get().focusedGroupId !== groupId && get().groups[groupId]) set({ focusedGroupId: groupId });
  },

  cycleTab: (dir) => {
    const { groups, focusedGroupId, setActiveTab } = get();
    const { tabIds, activeTabId } = groups[focusedGroupId];
    if (tabIds.length < 2) return;
    const idx = tabIds.indexOf(activeTabId ?? "");
    setActiveTab(tabIds[(idx + dir + tabIds.length) % tabIds.length]);
  },

  moveTab: (tabId, groupId, beforeTabId) =>
    set((s) => {
      if (beforeTabId === tabId || !s.groups[groupId]) return s;
      const groups = detachTab(s.groups, tabId);
      const target = groups[groupId];
      const tabIds = [...target.tabIds];
      const at = beforeTabId ? tabIds.indexOf(beforeTabId) : -1;
      tabIds.splice(at < 0 ? tabIds.length : at, 0, tabId);
      return pruneEmptyGroups({
        ...s,
        groups: { ...groups, [groupId]: { ...target, tabIds, activeTabId: tabId } },
        focusedGroupId: groupId,
      });
    }),

  splitTab: (tabId, targetGroupId, side) =>
    set((s) => {
      const source = groupOfTab(s.groups, tabId);
      // Splitting a group's only tab off itself would just recreate the same layout.
      if (!source || !s.groups[targetGroupId]) return s;
      if (source.id === targetGroupId && source.tabIds.length === 1) return s;
      const group: TabGroup = { id: newId(), tabIds: [tabId], activeTabId: tabId };
      return pruneEmptyGroups({
        ...s,
        groups: { ...detachTab(s.groups, tabId), [group.id]: group },
        layout: splitLeaf(s.layout, targetGroupId, side, group.id),
        focusedGroupId: group.id,
      });
    }),

  setSplitRatio: (splitId, ratio) => set((s) => ({ layout: setSplitRatio(s.layout, splitId, ratio) })),

  setStatus: (id, status) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, status } : t)) })),

  renameTab: (id, title) => {
    const name = title.trim();
    if (!name) return;
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, title: name } : t)) }));
  },

  reconnectTab: (id) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id ? { ...t, status: "connecting", generation: t.generation + 1 } : t,
      ),
    })),

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
}));
