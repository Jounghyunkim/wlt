import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { FontFamily, ThemeName } from "@/lib/themes";

export type CursorStyle = "block" | "bar" | "underline";
export type SidebarView = "terminals" | "explorer" | "history" | "search";

export interface Settings {
  theme: ThemeName;
  fontFamily: FontFamily;
  fontSize: number;
  lineHeight: number;
  cursorStyle: CursorStyle;
  cursorBlink: boolean;
  scrollback: number;
  ligatures: boolean;
  webgl: boolean;
  copyOnSelect: boolean;
  /** Command line used for new local tabs; empty = backend default. */
  defaultShell: string;
  /** Sidebar width in px, adjusted by dragging its inner edge. */
  sidebarWidth: number;
  /** View shown in the sidebar, picked from the activity bar. */
  sidebarView: SidebarView;
  /** Which window edge the activity bar and sidebar sit on. */
  sidebarSide: "left" | "right";
  /** Session logging; applies to sessions opened (or reconnected) after the change. */
  logEnabled: boolean;
  logOutput: boolean;
  logInput: boolean;
  /** Save plain text instead of the raw stream with escape sequences. */
  logStripAnsi: boolean;
  logTimestamps: boolean;
  /** Empty = Documents\WLT Logs. */
  logDir: string;
  /** Local shells report their folder (OSC 9;9) — see local.rs. */
  shellIntegration: boolean;
  /** Type a one-line folder reporter into fresh SSH shells. */
  sshShellIntegration: boolean;
  /**
   * Also put tabs the user closes into session history (and keep them alive
   * for `historyKeepMinutes`). Off: history only records tabs open when the app quits.
   */
  historyOnTabClose: boolean;
  /** Closed tabs stay alive this long for an instant return (0 = close right away). */
  historyKeepMinutes: number;
  historyKeepMax: number;
  /** Lines of screen saved per closed tab (0 = none). */
  historySnapshotLines: number;
  historyMaxEntries: number;
  /** The explorer follows the focused terminal's folder as you `cd`. */
  explorerFollowTerminal: boolean;
  /**
   * Folder the explorer opens in, per place: `local`, or `ssh:<session id>`
   * for a saved SSH session. Missing = the home folder.
   */
  explorerStartDirs: Record<string, string>;
  /** Order of the local shells (their command lines), set by dragging them in the sidebar. */
  shellOrder: string[];
}

export const SIDEBAR_MIN_WIDTH = 180;
export const SIDEBAR_MAX_WIDTH = 600;

export const DEFAULT_SETTINGS: Settings = {
  theme: "dracula",
  fontFamily: "JetBrains Mono",
  fontSize: 14,
  lineHeight: 1.15,
  cursorStyle: "block",
  cursorBlink: true,
  scrollback: 10000,
  ligatures: true,
  webgl: true,
  copyOnSelect: true,
  defaultShell: "",
  sidebarWidth: 256,
  sidebarView: "terminals",
  sidebarSide: "left",
  logEnabled: false,
  logOutput: true,
  logInput: false,
  logStripAnsi: true,
  logTimestamps: false,
  logDir: "",
  shellIntegration: true,
  sshShellIntegration: true,
  historyOnTabClose: false,
  historyKeepMinutes: 30,
  historyKeepMax: 5,
  historySnapshotLines: 1000,
  historyMaxEntries: 100,
  explorerFollowTerminal: false,
  explorerStartDirs: {},
  shellOrder: [],
};

/** `shells` in the user's order; shells not ordered yet (e.g. newly installed) keep their place at the end. */
export function orderShells<T extends { command: string }>(shells: T[], order: string[]): T[] {
  const rank = (s: T) => {
    const i = order.indexOf(s.command);
    return i === -1 ? order.length : i;
  };
  return shells.map((s, i) => ({ s, i })).sort((a, b) => rank(a.s) - rank(b.s) || a.i - b.i).map(({ s }) => s);
}

interface SettingsState extends Settings {
  update: (patch: Partial<Settings>) => void;
  reset: () => void;
  zoom: (delta: number) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      update: (patch) => set(patch),
      reset: () => set(DEFAULT_SETTINGS),
      zoom: (delta) =>
        set((s) => ({ fontSize: Math.min(32, Math.max(8, s.fontSize + delta)) })),
    }),
    {
      name: "wlt.settings",
      version: 1,
      partialize: ({ update: _u, reset: _r, zoom: _z, ...settings }) => settings,
    },
  ),
);
