use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::logger::LogManager;

/// Common interface for a running terminal session (local PTY or remote SSH).
pub trait TerminalBackend: Send + Sync {
    fn write(&self, data: &[u8]) -> Result<(), String>;
    fn resize(&self, cols: u16, rows: u16) -> Result<(), String>;
    fn close(&self);
}

/// Registry of live terminal sessions keyed by the id generated on the frontend.
#[derive(Default)]
pub struct TerminalManager {
    sessions: Mutex<HashMap<String, Arc<dyn TerminalBackend>>>,
}

impl TerminalManager {
    pub fn insert(&self, id: String, backend: Arc<dyn TerminalBackend>) {
        let old = self.sessions.lock().unwrap().insert(id, backend);
        if let Some(old) = old {
            old.close();
        }
    }

    /// Clones the handle out so that slow writes never hold the registry lock.
    pub fn get(&self, id: &str) -> Result<Arc<dyn TerminalBackend>, String> {
        self.sessions
            .lock()
            .unwrap()
            .get(id)
            .cloned()
            .ok_or_else(|| format!("terminal session not found: {id}"))
    }

    pub fn remove(&self, id: &str) -> Option<Arc<dyn TerminalBackend>> {
        self.sessions.lock().unwrap().remove(id)
    }

    pub fn close_all(&self) {
        let drained: Vec<_> = self.sessions.lock().unwrap().drain().collect();
        for (_, backend) in drained {
            backend.close();
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExitPayload {
    pub code: Option<i64>,
    pub reason: Option<String>,
}

pub fn output_event(id: &str) -> String {
    format!("terminal-output-{id}")
}

pub fn exit_event(id: &str) -> String {
    format!("terminal-exit-{id}")
}

pub fn emit_output(app: &AppHandle, id: &str, data: String) {
    if data.is_empty() {
        return;
    }
    if let Some(log) = app.state::<LogManager>().get(id) {
        log.output(&data);
    }
    let _ = app.emit(&output_event(id), data);
}

pub fn emit_exit(app: &AppHandle, id: &str, code: Option<i64>, reason: Option<String>) {
    app.state::<LogManager>().stop(id);
    let _ = app.emit(&exit_event(id), ExitPayload { code, reason });
}
