import { create } from "zustand";
import {
  LOCAL,
  fsApi,
  sameTarget,
  targetKey,
  type EditEvent,
  type FsEntry,
  type FsTarget,
  type TransferMode,
} from "@/lib/fs";
import { newId } from "@/lib/utils";

interface DirState {
  entries?: FsEntry[];
  loading: boolean;
  error?: string;
}

export type TransferStatus = "running" | "done" | "error" | "cancelled";

export interface Transfer {
  id: string;
  label: string;
  done: number;
  total: number;
  current: string;
  status: TransferStatus;
  error?: string;
  /** Top-level paths created at the destination (for "open"/"reveal"). */
  created?: string[];
  dst: FsTarget;
}

export interface FsClipboard {
  target: FsTarget;
  paths: string[];
  mode: TransferMode;
}

/** Cache key of a folder: folders of different targets never mix. */
export const dirKey = (target: FsTarget, path: string) => `${targetKey(target)}|${path}`;

interface ExplorerState {
  target: FsTarget;
  /** Current root folder per target key. */
  roots: Record<string, string>;
  dirs: Record<string, DirState>;
  expanded: Record<string, boolean>;
  /** Selected paths (of the current target) and the keyboard cursor. */
  selection: string[];
  cursor: string | null;
  clipboard: FsClipboard | null;
  transfers: Transfer[];
  /** Remote files open for editing (auto upload on save), with their last sync time. */
  edits: (EditEvent & { syncedAt?: number })[];
  /** Last failed operation, shown above the tree. */
  error: string | null;
  setError: (error: string | null) => void;

  setTarget: (target: FsTarget) => void;
  setRoot: (path: string, target?: FsTarget) => void;
  load: (path: string, target?: FsTarget) => Promise<void>;
  /** Reloads `path` if it's cached (i.e. shown or was shown). */
  reload: (target: FsTarget, path: string) => Promise<void>;
  toggle: (path: string, open?: boolean) => void;
  collapseAll: () => void;
  select: (paths: string[], cursor?: string | null) => void;
  setClipboard: (clipboard: FsClipboard | null) => void;
  startTransfer: (opts: {
    label: string;
    src: FsTarget;
    paths: string[];
    dst: FsTarget;
    dstDir: string;
    mode: TransferMode;
  }) => Promise<string[]>;
  cancelTransfer: (id: string) => void;
  dismissTransfer: (id: string) => void;
  clearFinishedTransfers: () => void;
  /** Opens a remote file locally; saving it uploads it back. */
  editRemote: (target: FsTarget, path: string) => Promise<void>;
  stopEdit: (id: string) => void;
}

let transferListener: Promise<unknown> | null = null;
let editListener: Promise<unknown> | null = null;

export const useExplorerStore = create<ExplorerState>()((set, get) => ({
  target: LOCAL,
  roots: {},
  dirs: {},
  expanded: {},
  selection: [],
  cursor: null,
  clipboard: null,
  transfers: [],
  edits: [],
  error: null,
  setError: (error) => set({ error }),

  setTarget: (target) => {
    if (sameTarget(target, get().target)) return;
    set({ target, selection: [], cursor: null });
  },

  setRoot: (path, target = get().target) =>
    set((s) => ({
      roots: { ...s.roots, [targetKey(target)]: path },
      ...(sameTarget(target, s.target) ? { selection: [], cursor: null } : {}),
    })),

  load: async (path, target = get().target) => {
    const key = dirKey(target, path);
    set((s) => ({ dirs: { ...s.dirs, [key]: { ...s.dirs[key], loading: true, error: undefined } } }));
    try {
      const entries = await fsApi.list(target, path);
      set((s) => ({ dirs: { ...s.dirs, [key]: { entries, loading: false } } }));
    } catch (e) {
      set((s) => ({ dirs: { ...s.dirs, [key]: { ...s.dirs[key], loading: false, error: String(e) } } }));
    }
  },

  reload: async (target, path) => {
    if (get().dirs[dirKey(target, path)]) await get().load(path, target);
  },

  toggle: (path, open) => {
    const { target, expanded, dirs, load } = get();
    const key = dirKey(target, path);
    const next = open ?? !expanded[key];
    set({ expanded: { ...expanded, [key]: next } });
    if (next && !dirs[key]?.entries) void load(path);
  },

  collapseAll: () => {
    const prefix = `${targetKey(get().target)}|`;
    set((s) => ({
      expanded: Object.fromEntries(Object.entries(s.expanded).filter(([k]) => !k.startsWith(prefix))),
    }));
  },

  select: (paths, cursor) => set({ selection: paths, cursor: cursor === undefined ? (paths.at(-1) ?? null) : cursor }),

  setClipboard: (clipboard) => set({ clipboard }),

  startTransfer: async ({ label, src, paths, dst, dstDir, mode }) => {
    transferListener ??= fsApi.onTransfer((p) => {
      if (p.finished) return; // the invoke result below has the final state
      set((s) => ({
        transfers: s.transfers.map((t) =>
          t.id === p.id ? { ...t, done: p.done, total: p.total, current: p.current } : t,
        ),
      }));
    });
    await transferListener;

    const id = newId();
    const update = (patch: Partial<Transfer>) =>
      set((s) => ({ transfers: s.transfers.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
    set((s) => ({
      transfers: [...s.transfers, { id, label, done: 0, total: 0, current: "", status: "running", dst }],
    }));
    try {
      const created = await fsApi.transfer(id, src, paths, dst, dstDir, mode);
      update({ status: "done", created, done: get().transfers.find((t) => t.id === id)?.total ?? 0 });
      return created;
    } catch (e) {
      const error = String(e);
      update(error === "cancelled" ? { status: "cancelled" } : { status: "error", error });
      throw e;
    } finally {
      // Show the result wherever it's on screen: the destination, and the sources' folders on a move.
      const { reload } = get();
      void reload(dst, dstDir);
      if (mode === "move") {
        for (const p of paths) {
          const parent = await fsApi.parent(src, p).catch(() => null);
          if (parent !== null) void reload(src, parent);
        }
      }
    }
  },

  cancelTransfer: (id) => void fsApi.cancelTransfer(id),

  dismissTransfer: (id) => set((s) => ({ transfers: s.transfers.filter((t) => t.id !== id) })),

  clearFinishedTransfers: () => set((s) => ({ transfers: s.transfers.filter((t) => t.status === "running") })),

  editRemote: async (target, path) => {
    editListener ??= fsApi.onEdit((e) =>
      set((s) => {
        if (e.status === "stopped") return { edits: s.edits.filter((x) => x.id !== e.id) };
        const prev = s.edits.find((x) => x.id === e.id);
        const next = { ...e, syncedAt: e.status === "uploaded" ? Date.now() : prev?.syncedAt };
        return { edits: prev ? s.edits.map((x) => (x.id === e.id ? next : x)) : [...s.edits, next] };
      }),
    );
    await editListener;
    const local = await fsApi.editRemote(target, path);
    await fsApi.open(local);
  },

  stopEdit: (id) => void fsApi.stopEdit(id),
}));
