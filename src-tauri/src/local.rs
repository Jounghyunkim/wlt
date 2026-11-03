use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use tauri::{AppHandle, Manager};

use crate::state::{emit_exit, emit_output, TerminalBackend, TerminalManager};
use crate::utf8::Utf8Decoder;

/// A local shell running inside a Windows ConPTY.
pub struct LocalTerminal {
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
}

impl TerminalBackend for LocalTerminal {
    fn write(&self, data: &[u8]) -> Result<(), String> {
        let mut w = self.writer.lock().unwrap();
        w.write_all(data).map_err(|e| e.to_string())?;
        w.flush().map_err(|e| e.to_string())
    }

    fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        self.master
            .lock()
            .unwrap()
            .resize(pty_size(cols, rows))
            .map_err(|e| e.to_string())
    }

    fn close(&self) {
        let _ = self.killer.lock().unwrap().kill();
    }
}

fn pty_size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        rows: rows.max(1),
        cols: cols.max(1),
        pixel_width: 0,
        pixel_height: 0,
    }
}

// ── Shell integration ───────────────────────────────────────────────────────
//
// Makes the shell report its working directory on every prompt with
// `OSC 9;9 "C:\path"` (the Windows Terminal convention), so a tab always knows
// where it is (session history, explorer sync). Only the launched process is
// affected; no profile file is touched.

/// Wraps whatever prompt the profile defined.
const PS_SCRIPT: &str = r#"$global:__wltPrompt = $function:prompt
function global:prompt {
  $p = & $global:__wltPrompt
  $loc = $executionContext.SessionState.Path.CurrentLocation
  if ($loc.Provider.Name -eq 'FileSystem') { "$([char]27)]9;9;`"$($loc.ProviderPath)`"$([char]27)\$p" } else { $p }
}"#;

/// Git Bash (MSYS): report the Windows form of $PWD.
const GIT_BASH_PROMPT_COMMAND: &str = r#"printf '\033]9;9;"%s"\033\\' "$(cygpath -w "$PWD")""#;

/// WSL: report the \\wsl.localhost\… path, which Windows tools (and the explorer) can open.
const WSL_PROMPT_COMMAND: &str = r#"printf '\033]9;9;"%s"\033\\' "$(wslpath -w "$PWD" 2>/dev/null)""#;

/// PowerShell's -EncodedCommand takes base64 of UTF-16LE: no quoting pitfalls.
fn encode_powershell(script: &str) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let bytes: Vec<u8> = script.encode_utf16().flat_map(u16::to_le_bytes).collect();
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = chunk.iter().enumerate().fold(0u32, |n, (i, b)| n | (u32::from(*b) << (16 - 8 * i)));
        for i in 0..4 {
            out.push(if i <= chunk.len() { ALPHABET[(n >> (18 - 6 * i)) as usize & 63] as char } else { '=' });
        }
    }
    out
}

fn apply_shell_integration(program: &str, args: &[String], cmd: &mut CommandBuilder) {
    let name = Path::new(program)
        .file_name()
        .map(|n| n.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let has_arg = |flags: &[&str]| args.iter().any(|a| flags.contains(&a.to_lowercase().as_str()));
    match name.trim_end_matches(".exe") {
        "pwsh" | "powershell" => {
            // A user command line that already runs something is left alone.
            if !has_arg(&["-command", "-c", "-file", "-f", "-encodedcommand", "-e", "-ec"]) {
                cmd.args(["-NoExit", "-EncodedCommand", &encode_powershell(PS_SCRIPT)]);
            }
        }
        "cmd" => {
            let prompt = std::env::var("PROMPT").unwrap_or_else(|_| "$P$G".into());
            cmd.env("PROMPT", format!("$e]9;9;$P$e\\{prompt}"));
        }
        "bash" => cmd.env("PROMPT_COMMAND", GIT_BASH_PROMPT_COMMAND),
        "wsl" => {
            cmd.env("PROMPT_COMMAND", WSL_PROMPT_COMMAND);
            // WSLENV lists the Windows variables passed into Linux.
            let wslenv = std::env::var("WSLENV").unwrap_or_default();
            let wslenv = if wslenv.is_empty() { "PROMPT_COMMAND/u".to_string() } else { format!("{wslenv}:PROMPT_COMMAND/u") };
            cmd.env("WSLENV", wslenv);
        }
        _ => {}
    }
}

pub fn spawn(
    app: AppHandle,
    id: String,
    shell: Option<String>,
    cwd: Option<String>,
    shell_integration: bool,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let pair = native_pty_system()
        .openpty(pty_size(cols, rows))
        .map_err(|e| format!("failed to open pty: {e}"))?;

    let shell = shell
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(default_shell);
    let argv = split_command_line(&shell);
    let (program, args) = argv
        .split_first()
        .ok_or_else(|| "empty shell command".to_string())?;

    let mut cmd = CommandBuilder::new(program);
    cmd.args(args);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    if shell_integration {
        apply_shell_integration(program, args, &mut cmd);
    }
    // A folder restored from session history may have been deleted meanwhile.
    let missing_cwd = cwd.as_deref().filter(|d| !d.is_empty() && !Path::new(d).is_dir()).map(str::to_string);
    let cwd = cwd
        .filter(|d| Path::new(d).is_dir())
        .or_else(|| std::env::var("USERPROFILE").ok());
    if let Some(dir) = cwd {
        cmd.cwd(dir);
    }
    if let Some(dir) = missing_cwd {
        emit_output(&app, &id, format!("\x1b[33m⚠ 폴더를 찾을 수 없어 홈 폴더에서 시작합니다: {dir}\x1b[0m\r\n"));
    }

    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("failed to start '{shell}': {e}"))?;
    // The slave handle must be released, otherwise the reader never sees EOF.
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let killer = child.clone_killer();

    let terminal = Arc::new(LocalTerminal {
        master: Mutex::new(pair.master),
        writer: Mutex::new(writer),
        killer: Mutex::new(killer),
    });

    // Register before the watcher threads start so an instantly-exiting shell
    // cannot race the registration and leave a stale entry behind.
    app.state::<TerminalManager>().insert(id.clone(), terminal);

    let exit_code: Arc<Mutex<Option<i64>>> = Arc::default();

    // Output pump: PTY -> frontend.
    {
        let app = app.clone();
        let id = id.clone();
        let exit_code = exit_code.clone();
        std::thread::Builder::new()
            .name(format!("pty-read-{id}"))
            .spawn(move || {
                let mut decoder = Utf8Decoder::default();
                let mut buf = vec![0u8; 64 * 1024];
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => emit_output(&app, &id, decoder.decode(&buf[..n])),
                    }
                }
                let code = *exit_code.lock().unwrap();
                emit_exit(&app, &id, code, None);
            })
            .map_err(|e| e.to_string())?;
    }

    // Exit watcher: on Windows the ConPTY output pipe stays open after the child
    // exits, so drop the master (ClosePseudoConsole) to let the reader hit EOF.
    {
        let app = app.clone();
        let id = id.clone();
        std::thread::Builder::new()
            .name(format!("pty-wait-{id}"))
            .spawn(move || {
                let status = child.wait();
                *exit_code.lock().unwrap() = status.ok().map(|s| s.exit_code() as i64);
                app.state::<TerminalManager>().remove(&id);
            })
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn default_shell() -> String {
    available_shells()
        .into_iter()
        .next()
        .map(|s| s.command)
        .unwrap_or_else(|| "cmd.exe".into())
}

#[derive(serde::Serialize, Clone)]
pub struct ShellInfo {
    pub name: String,
    pub command: String,
}

/// Shells found on this machine, most preferred first.
pub fn available_shells() -> Vec<ShellInfo> {
    let mut shells = Vec::new();
    let mut push = |name: &str, command: String| shells.push(ShellInfo { name: name.into(), command });

    if find_in_path("pwsh.exe").is_some() {
        push("PowerShell 7", "pwsh.exe -NoLogo".into());
    }
    if find_in_path("powershell.exe").is_some() {
        push("Windows PowerShell", "powershell.exe -NoLogo".into());
    }
    push("Command Prompt", "cmd.exe".into());
    if find_in_path("wsl.exe").is_some() {
        push("WSL", "wsl.exe".into());
    }
    let git_bash = std::env::var("ProgramFiles")
        .map(|p| PathBuf::from(p).join("Git").join("bin").join("bash.exe"))
        .ok()
        .filter(|p| p.is_file());
    if let Some(bash) = git_bash {
        push("Git Bash", format!("\"{}\" --login -i", bash.display()));
    }
    shells
}

fn find_in_path(exe: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|dir| dir.join(exe))
        .find(|p| p.is_file())
}

/// Splits a command line on whitespace, honouring double quotes.
fn split_command_line(line: &str) -> Vec<String> {
    let mut args = Vec::new();
    let mut cur = String::new();
    let mut in_quotes = false;
    let mut has_token = false;
    for c in line.chars() {
        match c {
            '"' => {
                in_quotes = !in_quotes;
                has_token = true;
            }
            c if c.is_whitespace() && !in_quotes => {
                if has_token {
                    args.push(std::mem::take(&mut cur));
                    has_token = false;
                }
            }
            c => {
                cur.push(c);
                has_token = true;
            }
        }
    }
    if has_token {
        args.push(cur);
    }
    args
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::{Duration, Instant};

    #[test]
    fn powershell_encoding_is_base64_utf16le() {
        // "ab" → 61 00 62 00 → "YQBiAA=="
        assert_eq!(encode_powershell("ab"), "YQBiAA==");
        assert_eq!(encode_powershell("abc"), "YQBiAGMA");
    }

    /// Runs `shell` in a real ConPTY with shell integration, types `cd`, and
    /// returns the first directory it reports via OSC 9;9 that contains `expect`.
    fn reported_cwd(shell: &str, cd: &str, expect: &str) -> Option<String> {
        let argv = split_command_line(shell);
        let (program, args) = argv.split_first()?;
        let pair = native_pty_system().openpty(pty_size(120, 30)).ok()?;
        let mut cmd = CommandBuilder::new(program);
        cmd.args(args);
        apply_shell_integration(program, args, &mut cmd);
        let mut child = pair.slave.spawn_command(cmd).ok()?;
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().ok()?;
        let mut writer = pair.master.take_writer().ok()?;
        let (tx, rx) = mpsc::channel::<Vec<u8>>();
        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            while let Ok(n) = reader.read(&mut buf) {
                if n == 0 || tx.send(buf[..n].to_vec()).is_err() {
                    break;
                }
            }
        });
        let deadline = Instant::now() + Duration::from_secs(20);
        let (mut out, mut sent_cd) = (String::new(), false);
        let found = loop {
            if Instant::now() > deadline {
                break None;
            }
            if let Ok(chunk) = rx.recv_timeout(Duration::from_millis(200)) {
                let text = String::from_utf8_lossy(&chunk);
                // ConPTY (and PSReadLine) ask for the cursor position; a real terminal answers.
                for _ in text.matches("\x1b[6n") {
                    let _ = writer.write_all(b"\x1b[1;1R");
                }
                out.push_str(&text);
            }
            if !sent_cd && out.contains("]9;9;") {
                sent_cd = true;
                let _ = writer.write_all(format!("{cd}\r").as_bytes());
            }
            let hit = out.split("]9;9;").skip(1).map(|s| s.split(['\x1b', '\x07']).next().unwrap_or("").trim_matches('"').to_string()).find(|p| p.to_lowercase().contains(&expect.to_lowercase()));
            if hit.is_some() {
                break hit;
            }
        };
        if found.is_none() {
            println!("RAW {shell}: {:?}", out.chars().take(1500).collect::<String>());
        }
        let _ = child.kill();
        found
    }

    #[test]
    fn shells_report_their_directory() {
        let windows = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into());
        for shell in available_shells() {
            let (cd, expect) = match shell.name.as_str() {
                "WSL" => ("cd /tmp", "tmp".to_string()),
                "Git Bash" => ("cd /c/Windows", windows.clone()),
                _ => ("cd C:\\Windows", windows.clone()),
            };
            let got = reported_cwd(&shell.command, cd, &expect);
            println!("{:<20} → {:?}", shell.name, got);
            assert!(got.is_some(), "{} did not report its directory", shell.name);
        }
    }

    #[test]
    fn splits_quoted_paths() {
        assert_eq!(
            split_command_line(r#""C:\Program Files\Git\bin\bash.exe" --login -i"#),
            vec![r"C:\Program Files\Git\bin\bash.exe", "--login", "-i"]
        );
        assert_eq!(split_command_line("cmd.exe"), vec!["cmd.exe"]);
    }
}
