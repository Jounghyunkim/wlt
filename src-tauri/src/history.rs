//! Screen snapshots of closed tabs for session history ("이전 세션 기록").
//!
//! Stored as files rather than in the webview's storage: they can be large,
//! and deleting a history entry must reliably delete what it captured.

use std::path::PathBuf;

use tauri::{AppHandle, Manager};

fn snapshot_path(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    // Ids are generated UUIDs; anything else could escape the folder.
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err(format!("invalid history id: {id}"));
    }
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("history");
    std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    Ok(dir.join(format!("{id}.ans")))
}

#[tauri::command]
pub async fn history_save_snapshot(app: AppHandle, id: String, data: String) -> Result<(), String> {
    let path = snapshot_path(&app, &id)?;
    std::fs::write(&path, data).map_err(|e| format!("cannot write {}: {e}", path.display()))
}

#[tauri::command]
pub async fn history_load_snapshot(app: AppHandle, id: String) -> Result<Option<String>, String> {
    let path = snapshot_path(&app, &id)?;
    match std::fs::read_to_string(&path) {
        Ok(data) => Ok(Some(data)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("cannot read {}: {e}", path.display())),
    }
}

/// Deletes the snapshots of these entries; `keep` = delete every snapshot NOT listed
/// (cleans up files left behind by entries that no longer exist).
#[tauri::command]
pub async fn history_delete_snapshots(app: AppHandle, ids: Vec<String>, keep: bool) -> Result<(), String> {
    if !keep {
        for id in &ids {
            let _ = std::fs::remove_file(snapshot_path(&app, id)?);
        }
        return Ok(());
    }
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("history");
    let Ok(entries) = std::fs::read_dir(&dir) else { return Ok(()) };
    for entry in entries.flatten() {
        let path = entry.path();
        let stem = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
        if path.extension().is_some_and(|e| e == "ans") && !ids.contains(&stem) {
            let _ = std::fs::remove_file(path);
        }
    }
    Ok(())
}
