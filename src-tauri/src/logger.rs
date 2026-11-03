//! Per-session log files.
//!
//! Output goes to `<dir>/<date>/<time>_<title>.log`, typed input to a sibling
//! `.input.log` (kept separate so the shell's echo doesn't interleave with it).

use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use chrono::Local;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogOptions {
    /// Empty = `Documents\WLT Logs`.
    pub dir: String,
    pub output: bool,
    pub input: bool,
    /// Turn escape sequences into plain text lines (otherwise the raw stream is kept).
    pub strip_ansi: bool,
    /// Prefix every plain text output line with the time (needs `strip_ansi`).
    pub timestamps: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogFiles {
    pub output: Option<String>,
    pub input: Option<String>,
}

pub fn resolve_dir(app: &AppHandle, dir: &str) -> Result<PathBuf, String> {
    let dir = dir.trim();
    if !dir.is_empty() {
        return Ok(PathBuf::from(dir));
    }
    app.path()
        .document_dir()
        .map(|d| d.join("WLT Logs"))
        .map_err(|e| format!("cannot resolve Documents folder: {e}"))
}

/// Makes a tab title safe to use in a Windows file name.
fn sanitize(title: &str) -> String {
    let cleaned: String = title
        .chars()
        .map(|c| if "<>:\"/\\|?*".contains(c) || c.is_control() { '_' } else { c })
        .take(60)
        .collect();
    let cleaned = cleaned.trim().trim_end_matches('.').to_string();
    if cleaned.is_empty() { "session".into() } else { cleaned }
}

/// Creates `<base><suffix>`, adding `_2`, `_3`… if a file with that name already exists.
fn create_unique(base: &Path, suffix: &str) -> Result<(PathBuf, File), String> {
    for n in 1..1000 {
        let mut name = base.as_os_str().to_owned();
        if n > 1 {
            name.push(format!("_{n}"));
        }
        name.push(suffix);
        let path = PathBuf::from(name);
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(file) => return Ok((path, file)),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("cannot create log file {}: {e}", path.display())),
        }
    }
    Err("too many log files with the same name".into())
}

// ── Escape sequence scanner ─────────────────────────────────────────────────

#[derive(Default)]
enum Esc {
    #[default]
    None,
    /// Just saw ESC.
    Start,
    /// ESC [ … final byte; collects the parameters.
    Csi(String),
    /// ESC O x (SS3, e.g. application-mode arrow keys).
    Ss3,
    /// ESC ( B and friends: one more byte to skip.
    Skip1,
    /// OSC / DCS / APC / PM string, ends with BEL or ESC \.
    Str,
    StrEsc,
}

/// What a scanned character turned out to be.
enum Token {
    Char(char),
    Csi(char, String),
    Ss3(char),
    Ignored,
}

impl Esc {
    fn feed(&mut self, c: char) -> Token {
        match std::mem::take(self) {
            Esc::None if c == '\x1b' => {
                *self = Esc::Start;
                Token::Ignored
            }
            Esc::None => Token::Char(c),
            Esc::Start => {
                *self = match c {
                    '[' => Esc::Csi(String::new()),
                    'O' => Esc::Ss3,
                    ']' | 'P' | '_' | '^' | 'X' => Esc::Str,
                    '(' | ')' | '*' | '+' | '#' | '%' => Esc::Skip1,
                    _ => Esc::None,
                };
                Token::Ignored
            }
            Esc::Csi(params) if ('\x40'..='\x7e').contains(&c) => Token::Csi(c, params),
            Esc::Csi(mut params) => {
                params.push(c);
                *self = Esc::Csi(params);
                Token::Ignored
            }
            Esc::Ss3 => Token::Ss3(c),
            Esc::Skip1 => Token::Ignored,
            Esc::Str => {
                *self = match c {
                    '\x07' => Esc::None,
                    '\x1b' => Esc::StrEsc,
                    _ => Esc::Str,
                };
                Token::Ignored
            }
            Esc::StrEsc => Token::Ignored,
        }
    }
}

fn csi_count(params: &str) -> usize {
    params.trim_start_matches('?').split(';').next().and_then(|n| n.parse().ok()).unwrap_or(1).clamp(1, 512)
}

// ── Output: terminal stream → plain text lines ──────────────────────────────

/// Approximates what the screen showed, line by line. Lines are only written
/// once complete, so a prompt and the command typed after it end up together.
#[derive(Default)]
struct TextLines {
    esc: Esc,
    line: String,
    /// A bare CR returns to column 0: the next printed char overwrites the line.
    pending_cr: bool,
}

impl TextLines {
    fn feed(&mut self, data: &str, out: &mut Vec<String>) {
        for c in data.chars() {
            match self.esc.feed(c) {
                Token::Char('\n') => {
                    self.pending_cr = false;
                    out.push(std::mem::take(&mut self.line));
                }
                Token::Char('\r') => self.pending_cr = true,
                Token::Char('\x08') => {
                    self.line.pop();
                }
                Token::Char(c) if c != '\t' && c.is_control() => {}
                Token::Char(c) => {
                    if std::mem::take(&mut self.pending_cr) {
                        self.line.clear();
                    }
                    self.line.push(c);
                }
                // ConPTY sends runs of spaces as "cursor forward".
                Token::Csi('C', params) => self.line.extend(std::iter::repeat_n(' ', csi_count(&params))),
                // Absolute cursor moves / clear screen: ConPTY repainting rows. Start a new line.
                Token::Csi('H' | 'f' | 'J', _) => {
                    if !self.line.trim().is_empty() {
                        out.push(std::mem::take(&mut self.line));
                    }
                    self.line.clear();
                    self.pending_cr = false;
                }
                _ => {}
            }
        }
    }

    fn finish(&mut self, out: &mut Vec<String>) {
        if !self.line.trim().is_empty() {
            out.push(std::mem::take(&mut self.line));
        }
    }
}

struct OutputLog {
    file: BufWriter<File>,
    /// `None` = raw mode (escape sequences kept).
    text: Option<TextLines>,
    timestamps: bool,
}

impl OutputLog {
    fn write_lines(&mut self, lines: Vec<String>) {
        for line in lines {
            let line = line.trim_end();
            let _ = if self.timestamps {
                writeln!(self.file, "[{}] {line}", Local::now().format("%H:%M:%S"))
            } else {
                writeln!(self.file, "{line}")
            };
        }
    }

    fn feed(&mut self, data: &str) {
        match &mut self.text {
            None => {
                let _ = self.file.write_all(data.as_bytes());
            }
            Some(text) => {
                let mut lines = Vec::new();
                text.feed(data, &mut lines);
                self.write_lines(lines);
            }
        }
        let _ = self.file.flush();
    }

    fn finish(&mut self) {
        if let Some(text) = &mut self.text {
            let mut lines = Vec::new();
            text.finish(&mut lines);
            self.write_lines(lines);
        }
    }
}

// ── Input: keystrokes → one timestamped line per Enter ──────────────────────

#[derive(Default)]
struct InputLines {
    esc: Esc,
    line: String,
    last_cr: bool,
}

impl InputLines {
    fn feed(&mut self, data: &str, out: &mut Vec<String>) {
        for c in data.chars() {
            let token = self.esc.feed(c);
            let was_cr = std::mem::replace(&mut self.last_cr, matches!(token, Token::Char('\r')));
            match token {
                Token::Char('\n') if was_cr => {}
                Token::Char('\r' | '\n') => out.push(std::mem::take(&mut self.line)),
                Token::Char('\x7f' | '\x08') => {
                    self.line.pop();
                }
                Token::Char('\t') => self.line.push_str("<Tab>"),
                // Ctrl+C / Ctrl+D end the line just like Enter.
                Token::Char(c @ ('\x03' | '\x04')) => {
                    self.line.push('^');
                    self.line.push((c as u8 + 0x40) as char);
                    out.push(std::mem::take(&mut self.line));
                }
                Token::Char(c) if (c as u32) < 0x20 => {
                    self.line.push('^');
                    self.line.push((c as u8 + 0x40) as char);
                }
                Token::Char(c) => self.line.push(c),
                // History navigation changes what the line means, so note it.
                Token::Csi('A', _) | Token::Ss3('A') => self.line.push_str("<Up>"),
                Token::Csi('B', _) | Token::Ss3('B') => self.line.push_str("<Down>"),
                _ => {}
            }
        }
    }
}

struct InputLog {
    file: BufWriter<File>,
    lines: InputLines,
}

impl InputLog {
    fn feed(&mut self, data: &str) {
        let mut lines = Vec::new();
        self.lines.feed(data, &mut lines);
        let now = Local::now().format("%Y-%m-%d %H:%M:%S");
        for line in lines {
            let _ = writeln!(self.file, "[{now}] {line}");
        }
        let _ = self.file.flush();
    }

    fn finish(&mut self) {
        if !self.lines.line.is_empty() {
            let line = std::mem::take(&mut self.lines.line);
            let _ = writeln!(self.file, "[{}] {line} (Enter 없이 종료)", Local::now().format("%Y-%m-%d %H:%M:%S"));
        }
    }
}

// ── Session log ─────────────────────────────────────────────────────────────

pub struct SessionLog {
    output: Mutex<Option<OutputLog>>,
    input: Mutex<Option<InputLog>>,
}

fn header(file: &mut BufWriter<File>, kind: &str, title: &str, target: &str) {
    let _ = writeln!(
        file,
        "===== WLT {kind} log: {title} ({target}) — started {} =====",
        Local::now().format("%Y-%m-%d %H:%M:%S")
    );
    let _ = file.flush();
}

fn footer(file: &mut BufWriter<File>) {
    let _ = writeln!(file, "\n===== ended {} =====", Local::now().format("%Y-%m-%d %H:%M:%S"));
    let _ = file.flush();
}

impl SessionLog {
    pub fn create(dir: &Path, title: &str, target: &str, opts: &LogOptions) -> Result<(Self, LogFiles), String> {
        let now = Local::now();
        let day_dir = dir.join(now.format("%Y-%m-%d").to_string());
        fs::create_dir_all(&day_dir).map_err(|e| format!("cannot create log folder {}: {e}", day_dir.display()))?;
        let base = day_dir.join(format!("{}_{}", now.format("%H%M%S"), sanitize(title)));

        let mut files = LogFiles { output: None, input: None };
        let output = if opts.output {
            let (path, file) = create_unique(&base, ".log")?;
            let mut file = BufWriter::new(file);
            header(&mut file, "output", title, target);
            files.output = Some(path.display().to_string());
            Some(OutputLog {
                file,
                text: opts.strip_ansi.then(TextLines::default),
                timestamps: opts.strip_ansi && opts.timestamps,
            })
        } else {
            None
        };
        let input = if opts.input {
            let (path, file) = create_unique(&base, ".input.log")?;
            let mut file = BufWriter::new(file);
            header(&mut file, "input", title, target);
            files.input = Some(path.display().to_string());
            Some(InputLog { file, lines: InputLines::default() })
        } else {
            None
        };
        Ok((Self { output: Mutex::new(output), input: Mutex::new(input) }, files))
    }

    pub fn output(&self, data: &str) {
        if let Some(log) = self.output.lock().unwrap().as_mut() {
            log.feed(data);
        }
    }

    pub fn input(&self, data: &str) {
        if let Some(log) = self.input.lock().unwrap().as_mut() {
            log.feed(data);
        }
    }

    /// Flushes pending text and writes the footer; later writes are ignored.
    pub fn close(&self) {
        if let Some(mut log) = self.output.lock().unwrap().take() {
            log.finish();
            footer(&mut log.file);
        }
        if let Some(mut log) = self.input.lock().unwrap().take() {
            log.finish();
            footer(&mut log.file);
        }
    }
}

/// Active session logs keyed by backend terminal id.
#[derive(Default)]
pub struct LogManager {
    logs: Mutex<HashMap<String, Arc<SessionLog>>>,
}

impl LogManager {
    pub fn start(&self, id: String, log: SessionLog) {
        if let Some(old) = self.logs.lock().unwrap().insert(id, Arc::new(log)) {
            old.close();
        }
    }

    pub fn get(&self, id: &str) -> Option<Arc<SessionLog>> {
        self.logs.lock().unwrap().get(id).cloned()
    }

    pub fn stop(&self, id: &str) {
        let log = self.logs.lock().unwrap().remove(id);
        if let Some(log) = log {
            log.close();
        }
    }

    pub fn stop_all(&self) {
        let drained: Vec<_> = self.logs.lock().unwrap().drain().collect();
        for (_, log) in drained {
            log.close();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(chunks: &[&str]) -> Vec<String> {
        let mut t = TextLines::default();
        let mut out = Vec::new();
        for c in chunks {
            t.feed(c, &mut out);
        }
        t.finish(&mut out);
        out
    }

    fn input(chunks: &[&str]) -> Vec<String> {
        let mut t = InputLines::default();
        let mut out = Vec::new();
        for c in chunks {
            t.feed(c, &mut out);
        }
        out
    }

    #[test]
    fn strips_colors_and_titles() {
        assert_eq!(
            text(&["\x1b]0;title\x07\x1b[32mgreen\x1b[0m text\r\n", "next"]),
            ["green text", "next"]
        );
    }

    #[test]
    fn escape_split_across_chunks() {
        assert_eq!(text(&["a\x1b[3", "1mb\r\n"]), ["ab"]);
    }

    #[test]
    fn conpty_cursor_forward_becomes_spaces() {
        assert_eq!(text(&["ls\x1b[3C-al\r\n"]), ["ls   -al"]);
    }

    #[test]
    fn carriage_return_overwrites_progress() {
        assert_eq!(text(&["10%\r50%\r100%\r\n"]), ["100%"]);
    }

    #[test]
    fn backspace_and_repaint() {
        assert_eq!(text(&["abc\x08\x08x\r\n", "\x1b[2;1Hrow2\x1b[3;1Hrow3"]), ["ax", "row2", "row3"]);
    }

    #[test]
    fn input_lines() {
        assert_eq!(input(&["ls -al", "\r", "cd fo\x7f\x7fbar\r\n", "\x1b[A\r", "sleep 9\x03"]), [
            "ls -al", "cd bar", "<Up>", "sleep 9^C"
        ]);
    }

    #[test]
    fn sanitizes_titles() {
        assert_eq!(sanitize("user@host:22/dev?"), "user@host_22_dev_");
        assert_eq!(sanitize("  ...  "), "session");
    }
}
