import { create } from "zustand";
import { LOCAL, fsApi, type FileMatches, type FsTarget, type SearchSummary } from "@/lib/fs";
import { newId } from "@/lib/utils";

export interface SearchScope {
  target: FsTarget;
  dir: string;
}

interface SearchState {
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
  include: string;
  exclude: string;
  /** Folder searched; filled from the explorer when empty. */
  scope: SearchScope | null;
  results: FileMatches[];
  summary: SearchSummary | null;
  status: "idle" | "searching" | "done" | "error";
  error: string | null;
  /** Result files folded in the tree. */
  collapsed: Record<string, boolean>;
  runId: string | null;

  set: (patch: Partial<Pick<SearchState, "query" | "caseSensitive" | "wholeWord" | "regex" | "include" | "exclude" | "scope" | "collapsed">>) => void;
  run: () => Promise<void>;
  cancel: () => void;
  clear: () => void;
}

const MAX_RESULTS = 2000;
let listening: Promise<unknown> | null = null;

/** Find-in-files state; kept outside the view so results survive switching sidebar views. */
export const useSearchStore = create<SearchState>()((set, get) => ({
  query: "",
  caseSensitive: false,
  wholeWord: false,
  regex: false,
  include: "",
  exclude: "",
  scope: null,
  results: [],
  summary: null,
  status: "idle",
  error: null,
  collapsed: {},
  runId: null,

  set: (patch) => set(patch),

  run: async () => {
    const { query, caseSensitive, wholeWord, regex, include, exclude, scope, runId } = get();
    if (runId) void fsApi.cancelSearch(runId);
    if (!query || !scope) {
      set({ results: [], summary: null, status: "idle", error: null, runId: null });
      return;
    }
    // Matches stream in per file; only the current run's are kept.
    listening ??= fsApi.onSearch((e) => {
      if (e.id === get().runId) set((s) => ({ results: [...s.results, e.file] }));
    });
    await listening;
    const id = newId();
    set({ runId: id, results: [], summary: null, status: "searching", error: null, collapsed: {} });
    try {
      const summary = await fsApi.search(id, scope.target ?? LOCAL, scope.dir, {
        query,
        caseSensitive,
        wholeWord,
        regex,
        include,
        exclude,
        maxResults: MAX_RESULTS,
      });
      if (get().runId === id) set({ summary, status: "done", runId: null });
    } catch (e) {
      if (get().runId === id) set({ status: "error", error: String(e), runId: null });
    }
  },

  cancel: () => {
    const { runId } = get();
    if (runId) void fsApi.cancelSearch(runId);
  },

  clear: () => {
    get().cancel();
    set({ query: "", results: [], summary: null, status: "idle", error: null, runId: null });
  },
}));
