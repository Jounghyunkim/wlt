/**
 * Typed bridge to the file explorer backend (src-tauri/src/files.rs).
 * A target is the local disk or SFTP over the SSH connection of a terminal tab.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type FsTarget = { kind: "local" } | { kind: "ssh"; connId: string };

export interface FsEntry {
  name: string;
  path: string;
  isDir: boolean;
  isSymlink: boolean;
  size: number;
  /** Unix seconds. */
  modified: number | null;
}

export type TransferMode = "copy" | "move";

export type TextEncoding = "utf-8" | "utf-8-bom" | "euc-kr";

export interface TextFile {
  content: string;
  encoding: TextEncoding;
  /** Unix seconds; sent back on save to detect changes by other programs. */
  modified: number | null;
  size: number;
}

export interface TransferProgress {
  id: string;
  done: number;
  total: number;
  current: string;
  finished: boolean;
  error: string | null;
}

export type EditStatus = "watching" | "uploading" | "uploaded" | "error" | "stopped";

/** State of a remote file opened for editing (`id` = `<conn id>|<remote path>`). */
export interface EditEvent {
  id: string;
  name: string;
  remotePath: string;
  localPath: string;
  status: EditStatus;
  error: string | null;
}

export interface SearchOptions {
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
  /** Comma-separated globs (`*.rs, src/**`). */
  include: string;
  exclude: string;
  maxResults: number;
}

export interface SearchMatch {
  line: number;
  /** 1-based, in characters. */
  column: number;
  length: number;
  /** The line, shortened around the match when long. */
  text: string;
  /** Where the match starts within `text`. */
  textOffset: number;
}

export interface FileMatches {
  path: string;
  matches: SearchMatch[];
}

export interface SearchSummary {
  files: number;
  matches: number;
  searched: number;
  truncated: boolean;
  cancelled: boolean;
}

export const LOCAL: FsTarget = { kind: "local" };

export function targetKey(t: FsTarget): string {
  return t.kind === "local" ? "local" : `ssh:${t.connId}`;
}

export function sameTarget(a: FsTarget, b: FsTarget): boolean {
  return targetKey(a) === targetKey(b);
}

export const fsApi = {
  home: (target: FsTarget) => invoke<string>("fs_home", { target }),
  list: (target: FsTarget, path: string) => invoke<FsEntry[]>("fs_list", { target, path }),
  /** `null` at the top; for the local disk the top is "" (the drive list). */
  parent: (target: FsTarget, path: string) => invoke<string | null>("fs_parent", { target, path }),
  create: (target: FsTarget, dir: string, name: string, isDir: boolean) =>
    invoke<string>("fs_create", { target, dir, name, isDir }),
  rename: (target: FsTarget, path: string, newName: string) =>
    invoke<string>("fs_rename", { target, path, newName }),
  /** Local: to the Recycle Bin. Remote: permanent. */
  remove: (target: FsTarget, paths: string[]) => invoke<void>("fs_delete", { target, paths }),
  /** Copy/move/download/upload; resolves to the created top-level paths. */
  transfer: (id: string, src: FsTarget, paths: string[], dst: FsTarget, dstDir: string, mode: TransferMode) =>
    invoke<string[]>("fs_transfer", { id, src, paths, dst, dstDir, mode }),
  cancelTransfer: (id: string) => invoke<void>("fs_cancel_transfer", { id }),
  /** Downloads a remote file to a temp copy, re-uploading it on every save; resolves to the local path. */
  editRemote: (target: FsTarget, path: string) => invoke<string>("fs_edit_remote", { target, path }),
  stopEdit: (id: string) => invoke<void>("fs_stop_edit", { id }),
  onEdit: (cb: (e: EditEvent) => void): Promise<UnlistenFn> => listen<EditEvent>("fs-edit", (e) => cb(e.payload)),
  /** Text for the built-in editor. Errors start with `BINARY:` / `TOO_LARGE:` when it should open externally. */
  readText: (target: FsTarget, path: string) => invoke<TextFile>("fs_read_text", { target, path }),
  /** Saves editor text; fails with `CONFLICT:` if the file changed since `expectedModified` (unless `force`). */
  writeText: (
    target: FsTarget,
    path: string,
    content: string,
    encoding: TextEncoding,
    expectedModified: number | null,
    force = false,
  ) => invoke<number | null>("fs_write_text", { target, path, content, encoding, expectedModified, force }),
  /** Find in files; matches stream in through `onSearch`, the summary resolves at the end. */
  search: (id: string, target: FsTarget, dir: string, options: SearchOptions) =>
    invoke<SearchSummary>("fs_search", { id, target, dir, options }),
  cancelSearch: (id: string) => invoke<void>("fs_search_cancel", { id }),
  onSearch: (cb: (e: { id: string; file: FileMatches }) => void): Promise<UnlistenFn> =>
    listen<{ id: string; file: FileMatches }>("fs-search", (e) => cb(e.payload)),
  open: (path: string) => invoke<void>("fs_open", { path }),
  reveal: (path: string) => invoke<void>("fs_reveal", { path }),
  onTransfer: (cb: (p: TransferProgress) => void): Promise<UnlistenFn> =>
    listen<TransferProgress>("fs-transfer", (e) => cb(e.payload)),
};

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}
