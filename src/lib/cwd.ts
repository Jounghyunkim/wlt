/**
 * Working-directory reports from shells ("shell integration").
 *
 * - OSC 7    `file://host/path` — Linux shells (and our remote integration below)
 * - OSC 9;9  `"C:\path"`        — Windows Terminal convention (our local integration, local.rs)
 * - OSC 0/2  window title        — fallback: Debian/Ubuntu bash titles are `user@host: ~/dir`
 */

/** OSC 7 payload → path. Windows drive paths arrive as `/C:/dir`. */
export function parseOsc7(data: string): string | null {
  const m = /^file:\/\/[^/]*(\/.*)$/.exec(data.trim());
  if (!m) return null;
  let path = m[1];
  try {
    path = decodeURIComponent(path);
  } catch {
    /* keep it as sent */
  }
  if (/^\/[A-Za-z]:/.test(path)) return path.slice(1).replace(/\//g, "\\");
  return path;
}

/** OSC 9 payload → path, for the `9;9` sub-command only (`9;4` is progress, etc.). */
export function parseOsc99(data: string): string | null {
  if (!data.startsWith("9;")) return null;
  const path = data.slice(2).trim().replace(/^"(.*)"$/, "$1");
  return path || null;
}

/** Window title → path, when it has the `user@host: path` shape. */
export function parseTitleCwd(title: string): string | null {
  const m = /^[^@\s]+@[^:\s]+:\s*(~(?:\/.*)?|\/.*)$/.exec(title.trim());
  return m ? m[1] : null;
}

/** Single-quotes a string for a POSIX shell. */
export const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** `cd` for a POSIX shell; keeps `~` unquoted so it still expands. */
export function posixCd(path: string): string {
  if (path === "~") return "cd ~";
  if (path.startsWith("~/")) return `cd -- ~/${shQuote(path.slice(2))}`;
  return `cd -- ${shQuote(path)}`;
}

/**
 * Defines an OSC 7 reporter for bash (PROMPT_COMMAND) and zsh (precmd). The
 * zsh array syntax is behind `eval` because sh/dash reject it even unexecuted.
 */
const REMOTE_INTEGRATION =
  '__wlt_cwd(){ printf \'\\033]7;file://%s%s\\033\\\\\' "${HOSTNAME:-}" "$PWD"; }; ' +
  'if [ -n "$ZSH_VERSION" ]; then eval "precmd_functions+=(__wlt_cwd)"; ' +
  'else PROMPT_COMMAND="__wlt_cwd${PROMPT_COMMAND:+;$PROMPT_COMMAND}"; fi';

/**
 * One line typed into a fresh remote shell: enables directory reporting, wipes
 * its own echo from the screen, then optionally `cd`s (after the wipe, so a
 * "No such file or directory" stays visible). The leading space keeps it out
 * of bash history where `HISTCONTROL` ignores space-prefixed commands (the
 * Debian/Ubuntu default).
 */
export function remoteIntegrationLine(cols: number, cd?: string): string {
  const head = ` ${REMOTE_INTEGRATION}; `;
  const tail = cd ? `; ${posixCd(cd)}` : "";
  // Rows taken by the echoed prompt + command (prompt length guessed at 30).
  const rows = Math.max(1, Math.ceil((head.length + 40 + tail.length + 30) / Math.max(20, cols)));
  return `${head}printf '\\r\\033[${rows}A\\033[J'${tail}\r`;
}
