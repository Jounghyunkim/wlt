/** Actions a mounted terminal exposes to UI outside it (e.g. the tab context menu). */
export interface TerminalHandle {
  /** Copies the whole buffer (scrollback + screen) or only the visible rows; resolves to the line count. */
  copyText: (scope: "all" | "screen") => Promise<number>;
  selectAll: () => void;
  /** Types text into the terminal as a paste (bracketed paste when the app asks for it). */
  paste: (text: string) => void;
  /** Last `lines` of the screen with colors (ANSI), for session history snapshots. */
  serialize: (lines: number) => string;
  /** Per-tab font size set with Ctrl+wheel, or null. */
  fontSize: () => number | null;
}

const handles = new Map<string, TerminalHandle>();

export const terminalRegistry = {
  register(tabId: string, handle: TerminalHandle) {
    handles.set(tabId, handle);
    return () => {
      if (handles.get(tabId) === handle) handles.delete(tabId);
    };
  },
  get: (tabId: string) => handles.get(tabId),
};
