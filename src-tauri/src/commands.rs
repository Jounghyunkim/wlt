use tauri::{AppHandle, State};

use crate::local::{self, ShellInfo};
use crate::logger::{self, LogFiles, LogManager, LogOptions, SessionLog};
use crate::ssh::{self, SshConfig};
use crate::state::TerminalManager;

// All commands are async so they run on the async runtime instead of the
// main (UI) thread.

#[tauri::command]
pub async fn list_shells() -> Vec<ShellInfo> {
    local::available_shells()
}

#[tauri::command]
pub async fn open_local_terminal(
    app: AppHandle,
    id: String,
    shell: Option<String>,
    cwd: Option<String>,
    shell_integration: Option<bool>,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    local::spawn(app, id, shell, cwd, shell_integration.unwrap_or(true), cols, rows)
}

#[tauri::command]
pub async fn open_ssh_terminal(
    app: AppHandle,
    id: String,
    config: SshConfig,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    ssh::connect(app, id, config, cols, rows).await
}

#[tauri::command]
pub async fn write_terminal(
    state: State<'_, TerminalManager>,
    logs: State<'_, LogManager>,
    id: String,
    data: String,
) -> Result<(), String> {
    state.get(&id)?.write(data.as_bytes())?;
    if let Some(log) = logs.get(&id) {
        log.input(&data);
    }
    Ok(())
}

/// Raw bytes from xterm's `onBinary` (e.g. legacy X10 mouse reports).
#[tauri::command]
pub async fn write_terminal_bytes(
    state: State<'_, TerminalManager>,
    id: String,
    data: Vec<u8>,
) -> Result<(), String> {
    state.get(&id)?.write(&data)
}

#[tauri::command]
pub async fn resize_terminal(
    state: State<'_, TerminalManager>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    state.get(&id)?.resize(cols, rows)
}

#[tauri::command]
pub async fn close_terminal(
    state: State<'_, TerminalManager>,
    logs: State<'_, LogManager>,
    id: String,
) -> Result<(), String> {
    if let Some(backend) = state.remove(&id) {
        backend.close();
    }
    logs.stop(&id);
    Ok(())
}

/// Starts logging session `id`; call before `open_*_terminal` so the first output is captured.
#[tauri::command]
pub async fn start_session_log(
    app: AppHandle,
    logs: State<'_, LogManager>,
    id: String,
    title: String,
    target: String,
    options: LogOptions,
) -> Result<LogFiles, String> {
    let dir = logger::resolve_dir(&app, &options.dir)?;
    let (log, files) = SessionLog::create(&dir, &title, &target, &options)?;
    logs.start(id, log);
    Ok(files)
}

#[tauri::command]
pub async fn default_log_dir(app: AppHandle) -> Result<String, String> {
    logger::resolve_dir(&app, "").map(|p| p.display().to_string())
}

/// Opens the log folder in Explorer, creating it first if needed.
#[tauri::command]
pub async fn open_log_folder(app: AppHandle, dir: String) -> Result<(), String> {
    let dir = logger::resolve_dir(&app, &dir)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    std::process::Command::new("explorer.exe")
        .arg(&dir)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("cannot open Explorer: {e}"))
}
