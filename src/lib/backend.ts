/**
 * Typed bridge to the Rust backend (src-tauri/src/commands.rs).
 *
 * Data flow:
 *   xterm.onData ──invoke("write_terminal")──▶ PTY / SSH channel
 *   PTY / SSH ──emit("terminal-output-<id>")──▶ xterm.write
 *   process exit ──emit("terminal-exit-<id>")──▶ tab status
 */
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type AuthMethod = "password" | "key" | "agent";

export type ForwardKind = "local" | "remote" | "dynamic";

/** SSH port forward: `-L` (local), `-R` (remote) or `-D` (dynamic SOCKS5). */
export interface PortForward {
  kind: ForwardKind;
  /** Listen address; empty = 127.0.0.1 on this PC (local/dynamic) or localhost on the server (remote). */
  bindHost?: string;
  bindPort: number;
  /** Unused for dynamic. */
  destHost?: string;
  destPort?: number;
}

export interface SshConnectConfig {
  host: string;
  port: number;
  username: string;
  authMethod: AuthMethod;
  /** Typed for this connection only; otherwise the saved one is read in Rust. */
  password?: string;
  privateKeyPath?: string;
  passphrase?: string;
  /** Saved session whose Credential Manager secrets may be used. */
  sessionId?: string;
  forwards?: PortForward[];
}

export type SecretKind = "password" | "passphrase";

export interface ShellInfo {
  name: string;
  command: string;
}

export interface ExitPayload {
  code: number | null;
  reason: string | null;
}

export interface LogOptions {
  dir: string;
  output: boolean;
  input: boolean;
  stripAnsi: boolean;
  timestamps: boolean;
}

export interface LogFiles {
  output: string | null;
  input: string | null;
}

export const isDesktop = isTauri();

export const backend = {
  listShells: () => invoke<ShellInfo[]>("list_shells"),

  openLocal: (
    id: string,
    opts: { shell?: string; cwd?: string; shellIntegration?: boolean; cols: number; rows: number },
  ) =>
    invoke<void>("open_local_terminal", { id, ...opts }),

  openSsh: (id: string, config: SshConnectConfig, cols: number, rows: number) =>
    invoke<void>("open_ssh_terminal", { id, config, cols, rows }),

  write: (id: string, data: string) => invoke<void>("write_terminal", { id, data }),

  writeBytes: (id: string, data: number[]) => invoke<void>("write_terminal_bytes", { id, data }),

  resize: (id: string, cols: number, rows: number) =>
    invoke<void>("resize_terminal", { id, cols, rows }),

  close: (id: string) => invoke<void>("close_terminal", { id }),

  /** Starts logging session `id`; call before opening it so the first output is captured. */
  startLog: (id: string, title: string, target: string, options: LogOptions) =>
    invoke<LogFiles>("start_session_log", { id, title, target, options }),

  defaultLogDir: () => invoke<string>("default_log_dir"),

  openLogFolder: (dir: string) => invoke<void>("open_log_folder", { dir }),

  /** Saves a session secret in the Windows Credential Manager (empty = delete). Write-only from JS. */
  credentialSet: (sessionId: string, kind: SecretKind, secret: string, label: string) =>
    invoke<void>("credential_set", { sessionId, kind, secret, label }),

  credentialDelete: (sessionId: string) => invoke<void>("credential_delete", { sessionId }),

  credentialCopy: (from: string, to: string, label: string) => invoke<void>("credential_copy", { from, to, label }),

  /** Screen snapshots of closed tabs (session history), stored as files by history.rs. */
  historySaveSnapshot: (id: string, data: string) => invoke<void>("history_save_snapshot", { id, data }),
  historyLoadSnapshot: (id: string) => invoke<string | null>("history_load_snapshot", { id }),
  /** `keep: true` deletes every snapshot NOT in `ids`. */
  historyDeleteSnapshots: (ids: string[], keep: boolean) => invoke<void>("history_delete_snapshots", { ids, keep }),

  onOutput: (id: string, cb: (data: string) => void): Promise<UnlistenFn> =>
    listen<string>(`terminal-output-${id}`, (e) => cb(e.payload)),

  onExit: (id: string, cb: (payload: ExitPayload) => void): Promise<UnlistenFn> =>
    listen<ExitPayload>(`terminal-exit-${id}`, (e) => cb(e.payload)),
};
