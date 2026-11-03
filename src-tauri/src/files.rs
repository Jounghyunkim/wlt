//! File explorer backend: one API over the local disk and SFTP. SFTP runs as a
//! subsystem channel on the SSH connection of an open terminal tab, so it
//! needs no second login.

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, UNIX_EPOCH};

use russh_sftp::client::SftpSession;
use russh_sftp::protocol::OpenFlags;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

use crate::ssh::SshHandle;

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum FsTarget {
    Local,
    /// SFTP over the SSH connection of terminal session `conn_id`.
    Ssh { conn_id: String },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: u64,
    /// Unix seconds.
    pub modified: Option<i64>,
}

// ── SFTP sessions ───────────────────────────────────────────────────────────

/// SSH connections that can host SFTP, and the SFTP sessions opened on them,
/// keyed by terminal session id.
#[derive(Default)]
pub struct SftpManager {
    handles: Mutex<HashMap<String, Arc<SshHandle>>>,
    sessions: tokio::sync::Mutex<HashMap<String, Arc<SftpSession>>>,
}

impl SftpManager {
    pub fn register(&self, id: String, handle: Arc<SshHandle>) {
        self.handles.lock().unwrap().insert(id, handle);
    }

    pub async fn unregister(&self, id: &str) {
        self.handles.lock().unwrap().remove(id);
        if let Some(sftp) = self.sessions.lock().await.remove(id) {
            let _ = sftp.close().await;
        }
    }

    /// Opens the SFTP session lazily on first use.
    async fn session(&self, id: &str) -> Result<Arc<SftpSession>, String> {
        let mut sessions = self.sessions.lock().await;
        if let Some(sftp) = sessions.get(id) {
            return Ok(sftp.clone());
        }
        let handle = self.handles.lock().unwrap().get(id).cloned();
        let handle = handle.ok_or("SSH connection is not available (tab closed or disconnected)")?;
        let channel = handle
            .channel_open_session()
            .await
            .map_err(|e| format!("cannot open SFTP channel: {e}"))?;
        channel
            .request_subsystem(true, "sftp")
            .await
            .map_err(|e| format!("server refused SFTP: {e}"))?;
        let sftp = SftpSession::new(channel.into_stream())
            .await
            .map_err(|e| format!("cannot start SFTP: {e}"))?;
        let sftp = Arc::new(sftp);
        sessions.insert(id.to_string(), sftp.clone());
        Ok(sftp)
    }
}

// ── File system abstraction ─────────────────────────────────────────────────

enum Fs {
    Local,
    Sftp(Arc<SftpSession>),
}

struct Stat {
    is_dir: bool,
    size: u64,
    /// Unix seconds.
    modified: Option<i64>,
}

type Reader = Box<dyn AsyncRead + Unpin + Send>;
type Writer = Box<dyn AsyncWrite + Unpin + Send>;

fn sftp_err(e: impl std::fmt::Display) -> String {
    format!("SFTP: {e}")
}

fn io_err(path: &str, e: std::io::Error) -> String {
    format!("{path}: {e}")
}

async fn resolve(app: &AppHandle, target: &FsTarget) -> Result<Fs, String> {
    match target {
        FsTarget::Local => Ok(Fs::Local),
        FsTarget::Ssh { conn_id } => Ok(Fs::Sftp(app.state::<SftpManager>().session(conn_id).await?)),
    }
}

fn unix_secs(time: std::io::Result<std::time::SystemTime>) -> Option<i64> {
    time.ok()?.duration_since(UNIX_EPOCH).ok().map(|d| d.as_secs() as i64)
}

impl Fs {
    fn join(&self, dir: &str, name: &str) -> String {
        match self {
            Fs::Local => Path::new(dir).join(name).to_string_lossy().into_owned(),
            Fs::Sftp(_) if dir.ends_with('/') => format!("{dir}{name}"),
            Fs::Sftp(_) => format!("{dir}/{name}"),
        }
    }

    fn name_of(&self, path: &str) -> String {
        match self {
            Fs::Local => Path::new(path)
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| path.trim_end_matches('\\').to_string()),
            Fs::Sftp(_) => path.trim_end_matches('/').rsplit('/').next().unwrap_or(path).to_string(),
        }
    }

    /// `None` at the top. For the local disk the top is "" (the drive list).
    fn parent_of(&self, path: &str) -> Option<String> {
        match self {
            Fs::Local if path.is_empty() => None,
            Fs::Local => Some(
                Path::new(path)
                    .parent()
                    .map(|p| p.to_string_lossy().into_owned())
                    .unwrap_or_default(),
            ),
            Fs::Sftp(_) => {
                let trimmed = path.trim_end_matches('/');
                if trimmed.is_empty() {
                    return None;
                }
                match trimmed.rsplit_once('/') {
                    Some(("", _)) => Some("/".into()),
                    Some((head, _)) => Some(head.into()),
                    None => Some(".".into()),
                }
            }
        }
    }

    fn validate_name(&self, name: &str) -> Result<(), String> {
        let bad: &[char] = match self {
            Fs::Local => &['<', '>', ':', '"', '/', '\\', '|', '?', '*'],
            Fs::Sftp(_) => &['/'],
        };
        if name.trim().is_empty() || name == "." || name == ".." || name.contains(bad) {
            return Err(format!("invalid name: {name}"));
        }
        Ok(())
    }

    async fn home(&self) -> Result<String, String> {
        match self {
            Fs::Local => std::env::var("USERPROFILE").map_err(|_| "USERPROFILE is not set".to_string()),
            Fs::Sftp(sftp) => sftp.canonicalize(".").await.map_err(sftp_err),
        }
    }

    async fn list(&self, path: &str) -> Result<Vec<FsEntry>, String> {
        let mut entries = match self {
            Fs::Local if path.is_empty() => local_drives(),
            Fs::Local => {
                let mut dir = tokio::fs::read_dir(path).await.map_err(|e| io_err(path, e))?;
                let mut out = Vec::new();
                while let Some(entry) = dir.next_entry().await.map_err(|e| io_err(path, e))? {
                    let full = entry.path();
                    let is_symlink = entry.file_type().await.map(|t| t.is_symlink()).unwrap_or(false);
                    // Follows links; locked system files (pagefile.sys…) just get no details.
                    let meta = tokio::fs::metadata(&full).await.ok();
                    out.push(FsEntry {
                        name: entry.file_name().to_string_lossy().into_owned(),
                        path: full.to_string_lossy().into_owned(),
                        is_dir: meta.as_ref().is_some_and(|m| m.is_dir()),
                        is_symlink,
                        size: meta.as_ref().map_or(0, |m| m.len()),
                        modified: meta.and_then(|m| unix_secs(m.modified())),
                    });
                }
                out
            }
            Fs::Sftp(sftp) => {
                let dir = sftp.read_dir(path).await.map_err(sftp_err)?;
                let mut out = Vec::new();
                for entry in dir {
                    let name = entry.file_name();
                    if name == "." || name == ".." {
                        continue;
                    }
                    let full = self.join(path, &name);
                    let meta = entry.metadata();
                    let is_symlink = meta.is_symlink();
                    let is_dir = if is_symlink {
                        sftp.metadata(full.clone()).await.is_ok_and(|m| m.is_dir())
                    } else {
                        meta.is_dir()
                    };
                    out.push(FsEntry {
                        name,
                        path: full,
                        is_dir,
                        is_symlink,
                        size: meta.size.unwrap_or(0),
                        modified: meta.mtime.map(i64::from),
                    });
                }
                out
            }
        };
        entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
        Ok(entries)
    }

    async fn stat(&self, path: &str) -> Result<Option<Stat>, String> {
        match self {
            Fs::Local => match tokio::fs::metadata(path).await {
                Ok(m) => Ok(Some(Stat { is_dir: m.is_dir(), size: m.len(), modified: unix_secs(m.modified()) })),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
                Err(e) => Err(io_err(path, e)),
            },
            Fs::Sftp(sftp) => {
                if !sftp.try_exists(path).await.map_err(sftp_err)? {
                    return Ok(None);
                }
                let m = sftp.metadata(path).await.map_err(sftp_err)?;
                Ok(Some(Stat { is_dir: m.is_dir(), size: m.size.unwrap_or(0), modified: m.mtime.map(i64::from) }))
            }
        }
    }

    async fn mkdir(&self, path: &str) -> Result<(), String> {
        match self {
            Fs::Local => tokio::fs::create_dir(path).await.map_err(|e| io_err(path, e)),
            Fs::Sftp(sftp) => sftp.create_dir(path).await.map_err(sftp_err),
        }
    }

    /// Creates an empty file; fails if it already exists.
    async fn create_file(&self, path: &str) -> Result<(), String> {
        match self {
            Fs::Local => tokio::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(path)
                .await
                .map(drop)
                .map_err(|e| io_err(path, e)),
            Fs::Sftp(sftp) => {
                let flags = OpenFlags::CREATE | OpenFlags::EXCLUDE | OpenFlags::WRITE;
                let mut file = sftp.open_with_flags(path, flags).await.map_err(sftp_err)?;
                file.shutdown().await.map_err(|e| io_err(path, e))
            }
        }
    }

    async fn rename(&self, from: &str, to: &str) -> Result<(), String> {
        match self {
            Fs::Local => tokio::fs::rename(from, to).await.map_err(|e| io_err(from, e)),
            Fs::Sftp(sftp) => sftp.rename(from, to).await.map_err(sftp_err),
        }
    }

    /// Deletes a file or a whole folder permanently.
    async fn remove_all(&self, path: &str) -> Result<(), String> {
        match self {
            Fs::Local => match tokio::fs::symlink_metadata(path).await {
                Ok(m) if m.is_dir() => tokio::fs::remove_dir_all(path).await.map_err(|e| io_err(path, e)),
                Ok(_) => tokio::fs::remove_file(path).await.map_err(|e| io_err(path, e)),
                Err(e) => Err(io_err(path, e)),
            },
            Fs::Sftp(sftp) => {
                enum Step {
                    Visit(String),
                    RemoveDir(String),
                }
                // Iterative post-order walk: children are removed before their folder.
                let mut stack = vec![Step::Visit(path.to_string())];
                while let Some(step) = stack.pop() {
                    match step {
                        Step::RemoveDir(p) => sftp.remove_dir(p).await.map_err(sftp_err)?,
                        Step::Visit(p) => {
                            let meta = sftp.symlink_metadata(p.clone()).await.map_err(sftp_err)?;
                            if meta.is_dir() && !meta.is_symlink() {
                                let children = sftp.read_dir(p.clone()).await.map_err(sftp_err)?;
                                stack.push(Step::RemoveDir(p.clone()));
                                for child in children {
                                    let name = child.file_name();
                                    if name != "." && name != ".." {
                                        stack.push(Step::Visit(self.join(&p, &name)));
                                    }
                                }
                            } else {
                                sftp.remove_file(p).await.map_err(sftp_err)?;
                            }
                        }
                    }
                }
                Ok(())
            }
        }
    }

    async fn reader(&self, path: &str) -> Result<Reader, String> {
        Ok(match self {
            Fs::Local => Box::new(tokio::fs::File::open(path).await.map_err(|e| io_err(path, e))?),
            Fs::Sftp(sftp) => Box::new(sftp.open(path).await.map_err(sftp_err)?),
        })
    }

    async fn writer(&self, path: &str) -> Result<Writer, String> {
        Ok(match self {
            Fs::Local => Box::new(tokio::fs::File::create(path).await.map_err(|e| io_err(path, e))?),
            Fs::Sftp(sftp) => Box::new(sftp.create(path).await.map_err(sftp_err)?),
        })
    }

    /// `dir/name`, or VS Code style `name copy.ext`, `name copy 2.ext`… if taken.
    async fn unique_path(&self, dir: &str, name: &str, reserved: &mut HashSet<String>) -> Result<String, String> {
        let (stem, ext) = match name.rsplit_once('.') {
            Some((stem, ext)) if !stem.is_empty() => (stem, format!(".{ext}")),
            _ => (name, String::new()),
        };
        for n in 0..10_000 {
            let candidate = match n {
                0 => name.to_string(),
                1 => format!("{stem} copy{ext}"),
                n => format!("{stem} copy {n}{ext}"),
            };
            let path = self.join(dir, &candidate);
            if !reserved.contains(&path) && self.stat(&path).await?.is_none() {
                reserved.insert(path.clone());
                return Ok(path);
            }
        }
        Err(format!("no free name for {name}"))
    }
}

fn local_drives() -> Vec<FsEntry> {
    (b'A'..=b'Z')
        .map(|c| format!("{}:\\", c as char))
        .filter(|root| Path::new(root).exists())
        .map(|root| FsEntry {
            name: root.trim_end_matches('\\').to_string(),
            path: root,
            is_dir: true,
            is_symlink: false,
            size: 0,
            modified: None,
        })
        .collect()
}

/// Is `inner` the same as, or inside, folder `outer`?
fn is_within(fs: &Fs, inner: &str, outer: &str) -> bool {
    let (sep, fold) = match fs {
        Fs::Local => ('\\', true),
        Fs::Sftp(_) => ('/', false),
    };
    let norm = |p: &str| {
        let p = p.trim_end_matches(sep).to_string();
        if fold { p.to_lowercase() } else { p }
    };
    let (inner, outer) = (norm(inner), norm(outer));
    inner == outer || inner.starts_with(&format!("{outer}{sep}"))
}

fn same_path(fs: &Fs, a: &str, b: &str) -> bool {
    is_within(fs, a, b) && is_within(fs, b, a)
}

/// Moves local files to the Recycle Bin.
#[cfg(windows)]
fn move_to_recycle_bin(paths: &[String]) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;

    #[repr(C)]
    struct ShFileOpStructW {
        hwnd: isize,
        func: u32,
        from: *const u16,
        to: *const u16,
        flags: u16,
        any_operations_aborted: i32,
        name_mappings: *mut std::ffi::c_void,
        progress_title: *const u16,
    }
    #[link(name = "shell32")]
    extern "system" {
        fn SHFileOperationW(op: *mut ShFileOpStructW) -> i32;
    }
    const FO_DELETE: u32 = 3;
    const FOF_SILENT: u16 = 0x0004;
    const FOF_NOCONFIRMATION: u16 = 0x0010;
    const FOF_ALLOWUNDO: u16 = 0x0040;
    const FOF_NOERRORUI: u16 = 0x0400;

    // Double-NUL-terminated list of absolute paths.
    let mut from: Vec<u16> = Vec::new();
    for p in paths {
        from.extend(std::ffi::OsStr::new(p).encode_wide());
        from.push(0);
    }
    from.push(0);
    let mut op = ShFileOpStructW {
        hwnd: 0,
        func: FO_DELETE,
        from: from.as_ptr(),
        to: std::ptr::null(),
        flags: FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT | FOF_NOERRORUI,
        any_operations_aborted: 0,
        name_mappings: std::ptr::null_mut(),
        progress_title: std::ptr::null(),
    };
    // SAFETY: `op` and the `from` buffer it points to live across the call.
    let rc = unsafe { SHFileOperationW(&mut op) };
    if rc != 0 || op.any_operations_aborted != 0 {
        return Err(format!("cannot move to the Recycle Bin (error {rc:#x})"));
    }
    Ok(())
}

// ── Transfers (copy / move / download / upload) ─────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TransferMode {
    Copy,
    Move,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TransferProgress {
    id: String,
    done: u64,
    total: u64,
    current: String,
    finished: bool,
    error: Option<String>,
}

#[derive(Default)]
pub struct TransferManager {
    cancels: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

struct Item {
    src: String,
    dst: String,
    is_dir: bool,
    size: u64,
}

const CANCELLED: &str = "cancelled";

/// Copies/moves between two file systems; `same` = both are the same target.
#[allow(clippy::too_many_arguments)]
async fn transfer(
    src_fs: &Fs,
    dst_fs: &Fs,
    same: bool,
    id: &str,
    cancel: &AtomicBool,
    paths: &[String],
    dst_dir: &str,
    mode: TransferMode,
    emit: &(dyn Fn(&TransferProgress) + Sync),
) -> Result<Vec<String>, String> {
    let mut progress = TransferProgress {
        id: id.to_string(),
        done: 0,
        total: 0,
        current: String::new(),
        finished: false,
        error: None,
    };

    // 1. Plan: destination names and every file/folder to create.
    let mut reserved = HashSet::new();
    let mut roots = Vec::new();
    let mut renames = Vec::new();
    let mut items = Vec::new();
    for path in paths {
        let stat = src_fs.stat(path).await?.ok_or_else(|| format!("not found: {path}"))?;
        if same && stat.is_dir && is_within(&src_fs, dst_dir, path) {
            return Err(format!("cannot copy a folder into itself: {path}"));
        }
        if same && mode == TransferMode::Move && src_fs.parent_of(path).is_some_and(|p| same_path(&src_fs, &p, dst_dir)) {
            continue; // already in that folder
        }
        let dest = dst_fs.unique_path(dst_dir, &src_fs.name_of(path), &mut reserved).await?;
        roots.push(dest.clone());
        if same && mode == TransferMode::Move {
            renames.push((path.clone(), dest));
            continue;
        }
        let mut stack = vec![(path.clone(), dest, stat.is_dir, stat.size)];
        while let Some((s, d, is_dir, size)) = stack.pop() {
            if is_dir {
                for child in src_fs.list(&s).await?.into_iter().rev() {
                    // Symlinked folders are skipped: following them can loop, and they can't be read as files.
                    if child.is_dir && child.is_symlink {
                        continue;
                    }
                    let to = dst_fs.join(&d, &child.name);
                    stack.push((child.path, to, child.is_dir, child.size));
                }
            }
            items.push(Item { src: s, dst: d, is_dir, size });
        }
    }
    // Pre-order with children pushed after their folder → reorder so folders come first.
    items.sort_by_key(|i| !i.is_dir);
    progress.total = items.iter().map(|i| i.size).sum();

    // 2. Same-target moves are plain renames.
    for (from, to) in &renames {
        dst_fs.rename(from, to).await?;
    }

    // 3. Copy.
    let mut last_emit = Instant::now();
    let mut buf = vec![0u8; 256 * 1024];
    for item in &items {
        if cancel.load(Ordering::Relaxed) {
            return Err(CANCELLED.into());
        }
        progress.current = src_fs.name_of(&item.src);
        if item.is_dir {
            if dst_fs.stat(&item.dst).await?.is_none() {
                dst_fs.mkdir(&item.dst).await?;
            }
            continue;
        }
        let mut reader = src_fs.reader(&item.src).await?;
        let mut writer = dst_fs.writer(&item.dst).await?;
        loop {
            if cancel.load(Ordering::Relaxed) {
                drop(writer);
                let _ = dst_fs.remove_all(&item.dst).await;
                return Err(CANCELLED.into());
            }
            let n = reader.read(&mut buf).await.map_err(|e| io_err(&item.src, e))?;
            if n == 0 {
                break;
            }
            writer.write_all(&buf[..n]).await.map_err(|e| io_err(&item.dst, e))?;
            progress.done += n as u64;
            if last_emit.elapsed() >= Duration::from_millis(150) {
                emit(&progress);
                last_emit = Instant::now();
            }
        }
        writer.shutdown().await.map_err(|e| io_err(&item.dst, e))?;
        emit(&progress);
    }

    // 4. Cross-target move: remove the originals once everything is copied.
    if mode == TransferMode::Move && !same {
        for path in paths {
            src_fs.remove_all(path).await?;
        }
    }
    Ok(roots)
}

// ── Commands ────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn fs_home(app: AppHandle, target: FsTarget) -> Result<String, String> {
    resolve(&app, &target).await?.home().await
}

#[tauri::command]
pub async fn fs_list(app: AppHandle, target: FsTarget, path: String) -> Result<Vec<FsEntry>, String> {
    resolve(&app, &target).await?.list(&path).await
}

#[tauri::command]
pub async fn fs_parent(app: AppHandle, target: FsTarget, path: String) -> Result<Option<String>, String> {
    Ok(resolve(&app, &target).await?.parent_of(&path))
}

/// Creates `dir/name` (a folder when `is_dir`) and returns its path.
#[tauri::command]
pub async fn fs_create(app: AppHandle, target: FsTarget, dir: String, name: String, is_dir: bool) -> Result<String, String> {
    let fs = resolve(&app, &target).await?;
    fs.validate_name(&name)?;
    let path = fs.join(&dir, &name);
    if fs.stat(&path).await?.is_some() {
        return Err(format!("already exists: {name}"));
    }
    if is_dir { fs.mkdir(&path).await? } else { fs.create_file(&path).await? }
    Ok(path)
}

/// Renames in place and returns the new path.
#[tauri::command]
pub async fn fs_rename(app: AppHandle, target: FsTarget, path: String, new_name: String) -> Result<String, String> {
    let fs = resolve(&app, &target).await?;
    fs.validate_name(&new_name)?;
    let parent = fs.parent_of(&path).ok_or("cannot rename the root")?;
    let to = fs.join(&parent, &new_name);
    if to == path {
        return Ok(to);
    }
    // Case-only renames on Windows hit the same file; let the OS handle those.
    let case_only = matches!(fs, Fs::Local) && to.to_lowercase() == path.to_lowercase();
    if !case_only && fs.stat(&to).await?.is_some() {
        return Err(format!("already exists: {new_name}"));
    }
    fs.rename(&path, &to).await?;
    Ok(to)
}

/// Local files go to the Recycle Bin; remote ones are deleted permanently.
#[tauri::command]
pub async fn fs_delete(app: AppHandle, target: FsTarget, paths: Vec<String>) -> Result<(), String> {
    match resolve(&app, &target).await? {
        #[cfg(windows)]
        Fs::Local => tauri::async_runtime::spawn_blocking(move || move_to_recycle_bin(&paths))
            .await
            .map_err(|e| e.to_string())?,
        fs => {
            for path in &paths {
                fs.remove_all(path).await?;
            }
            Ok(())
        }
    }
}

/// Copies or moves `paths` from `src` into `dst_dir` on `dst` (any combination of
/// local / SFTP, so this is also download and upload). Never overwrites: taken
/// names get a " copy" suffix. Progress is emitted as `fs-transfer` events.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn fs_transfer(
    app: AppHandle,
    transfers: tauri::State<'_, TransferManager>,
    id: String,
    src: FsTarget,
    paths: Vec<String>,
    dst: FsTarget,
    dst_dir: String,
    mode: TransferMode,
) -> Result<Vec<String>, String> {
    let cancel = Arc::new(AtomicBool::new(false));
    transfers.cancels.lock().unwrap().insert(id.clone(), cancel.clone());
    let result = async {
        let src_fs = resolve(&app, &src).await?;
        let dst_fs = resolve(&app, &dst).await?;
        let emit = |p: &TransferProgress| {
            let _ = app.emit("fs-transfer", p.clone());
        };
        transfer(&src_fs, &dst_fs, src == dst, &id, &cancel, &paths, &dst_dir, mode, &emit).await
    }
    .await;
    transfers.cancels.lock().unwrap().remove(&id);
    let _ = app.emit(
        "fs-transfer",
        TransferProgress {
            id,
            done: 0,
            total: 0,
            current: String::new(),
            finished: true,
            error: result.as_ref().err().cloned(),
        },
    );
    result
}

#[tauri::command]
pub async fn fs_cancel_transfer(transfers: tauri::State<'_, TransferManager>, id: String) -> Result<(), String> {
    if let Some(flag) = transfers.cancels.lock().unwrap().get(&id) {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(())
}

// ── Built-in editor: read / write text files ────────────────────────────────

/// Bigger files are opened with an external app instead.
const MAX_TEXT_FILE: u64 = 10 * 1024 * 1024;
const UTF8_BOM: &[u8] = b"\xEF\xBB\xBF";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextFile {
    content: String,
    /// "utf-8" | "utf-8-bom" | "euc-kr" — saved back the same way.
    encoding: &'static str,
    modified: Option<i64>,
    size: u64,
}

/// UTF-8 (with or without BOM) when valid, otherwise EUC-KR / CP949 — the
/// legacy Windows encoding of Korean text files. NUL bytes mean binary.
fn decode_text(bytes: &[u8]) -> Result<(String, &'static str), String> {
    if bytes[..bytes.len().min(8192)].contains(&0) {
        return Err("BINARY: binary file".into());
    }
    if let Some(rest) = bytes.strip_prefix(UTF8_BOM) {
        return Ok((String::from_utf8_lossy(rest).into_owned(), "utf-8-bom"));
    }
    match std::str::from_utf8(bytes) {
        Ok(text) => Ok((text.to_string(), "utf-8")),
        Err(_) => Ok((encoding_rs::EUC_KR.decode(bytes).0.into_owned(), "euc-kr")),
    }
}

fn encode_text(text: &str, encoding: &str) -> Vec<u8> {
    match encoding {
        "utf-8-bom" => [UTF8_BOM, text.as_bytes()].concat(),
        "euc-kr" => encoding_rs::EUC_KR.encode(text).0.into_owned(),
        _ => text.as_bytes().to_vec(),
    }
}

/// Errors start with `BINARY:` / `TOO_LARGE:` when the file should open externally instead.
#[tauri::command]
pub async fn fs_read_text(app: AppHandle, target: FsTarget, path: String) -> Result<TextFile, String> {
    let fs = resolve(&app, &target).await?;
    let stat = fs.stat(&path).await?.ok_or_else(|| format!("not found: {path}"))?;
    if stat.is_dir {
        return Err(format!("is a folder: {path}"));
    }
    if stat.size > MAX_TEXT_FILE {
        return Err(format!("TOO_LARGE: {} MB", stat.size / 1024 / 1024));
    }
    let mut bytes = Vec::with_capacity(stat.size as usize);
    fs.reader(&path).await?.read_to_end(&mut bytes).await.map_err(|e| io_err(&path, e))?;
    let (content, encoding) = decode_text(&bytes)?;
    Ok(TextFile { content, encoding, modified: stat.modified, size: stat.size })
}

/// Saves editor text. Unless `force`, refuses (error starting with `CONFLICT:`)
/// when the file changed on disk since `expected_modified`. Returns the new modified time.
#[tauri::command]
pub async fn fs_write_text(
    app: AppHandle,
    target: FsTarget,
    path: String,
    content: String,
    encoding: String,
    expected_modified: Option<i64>,
    force: bool,
) -> Result<Option<i64>, String> {
    let fs = resolve(&app, &target).await?;
    if !force {
        let current = fs.stat(&path).await?.and_then(|s| s.modified);
        if expected_modified.is_some() && current.is_some() && current != expected_modified {
            return Err("CONFLICT: the file was changed by another program after it was opened".into());
        }
    }
    let mut writer = fs.writer(&path).await?;
    writer.write_all(&encode_text(&content, &encoding)).await.map_err(|e| io_err(&path, e))?;
    writer.shutdown().await.map_err(|e| io_err(&path, e))?;
    Ok(fs.stat(&path).await?.and_then(|s| s.modified))
}

// ── Editing remote files: open → save → automatic upload ────────────────────

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EditEvent {
    id: String,
    name: String,
    remote_path: String,
    local_path: String,
    /// "watching" | "uploading" | "uploaded" | "error" | "stopped"
    status: &'static str,
    error: Option<String>,
}

struct Edit {
    conn_id: String,
    name: String,
    remote_path: String,
    local_path: std::path::PathBuf,
    task: tauri::async_runtime::JoinHandle<()>,
}

/// Remote files opened for editing, keyed by `<conn id>|<remote path>`.
#[derive(Default)]
pub struct EditManager {
    edits: Mutex<HashMap<String, Edit>>,
}

fn emit_edit(app: &AppHandle, id: &str, e: &Edit, status: &'static str, error: Option<String>) {
    let _ = app.emit(
        "fs-edit",
        EditEvent {
            id: id.to_string(),
            name: e.name.clone(),
            remote_path: e.remote_path.clone(),
            local_path: e.local_path.to_string_lossy().into_owned(),
            status,
            error,
        },
    );
}

impl EditManager {
    fn stop(&self, app: &AppHandle, id: &str) {
        let edit = self.edits.lock().unwrap().remove(id);
        if let Some(edit) = edit {
            edit.task.abort();
            emit_edit(app, id, &edit, "stopped", None);
        }
    }

    /// Stops syncing every file of a connection (called when it closes).
    pub fn stop_conn(&self, app: &AppHandle, conn_id: &str) {
        let ids: Vec<String> = self
            .edits
            .lock()
            .unwrap()
            .iter()
            .filter(|(_, e)| e.conn_id == conn_id)
            .map(|(id, _)| id.clone())
            .collect();
        for id in ids {
            self.stop(app, &id);
        }
    }
}

type Stamp = Option<(std::time::SystemTime, u64)>;

async fn stamp(path: &Path) -> Stamp {
    let m = tokio::fs::metadata(path).await.ok()?;
    Some((m.modified().ok()?, m.len()))
}

async fn upload_file(sftp: &SftpSession, local: &Path, remote: &str) -> Result<(), String> {
    let mut reader = tokio::fs::File::open(local).await.map_err(|e| io_err(&local.to_string_lossy(), e))?;
    let mut writer = sftp.create(remote).await.map_err(sftp_err)?;
    tokio::io::copy(&mut reader, &mut writer).await.map_err(|e| io_err(remote, e))?;
    writer.shutdown().await.map_err(|e| io_err(remote, e))
}

/// Polls the local copy once a second. A change is uploaded once it has
/// settled (same size and time on two polls), because editors often save in
/// several writes or via a temp file + rename.
async fn watch_edit(app: AppHandle, id: String, sftp: Arc<SftpSession>, remote: String, local: std::path::PathBuf) {
    let mut synced = stamp(&local).await;
    let mut last_seen = synced;
    loop {
        tokio::time::sleep(Duration::from_secs(1)).await;
        let now = stamp(&local).await;
        if now.is_some() && now != synced && now == last_seen {
            let snapshot = |status, error| {
                if let Some(e) = app.state::<EditManager>().edits.lock().unwrap().get(&id) {
                    emit_edit(&app, &id, e, status, error);
                }
            };
            snapshot("uploading", None);
            // On failure don't retry every second; the next save tries again.
            synced = now;
            match upload_file(&sftp, &local, &remote).await {
                Ok(()) => snapshot("uploaded", None),
                Err(e) => snapshot("error", Some(e)),
            }
        }
        last_seen = now;
    }
}

fn short_hash(s: &str) -> String {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    s.hash(&mut h);
    format!("{:016x}", h.finish())
}

/// Downloads a remote file to a private temp folder (keeping its name, so the
/// right app opens it), then uploads it back whenever it's saved, until the
/// SSH connection closes or `fs_stop_edit` is called. Returns the local path.
#[tauri::command]
pub async fn fs_edit_remote(app: AppHandle, target: FsTarget, path: String) -> Result<String, String> {
    let FsTarget::Ssh { conn_id } = &target else {
        return Err("only remote files are synced".into());
    };
    let id = format!("{conn_id}|{path}");
    {
        let edits = app.state::<EditManager>();
        let edits = edits.edits.lock().unwrap();
        if let Some(e) = edits.get(&id) {
            if e.local_path.exists() {
                return Ok(e.local_path.to_string_lossy().into_owned()); // already open: reuse the copy
            }
        }
    }

    let fs = resolve(&app, &target).await?;
    let Fs::Sftp(sftp) = &fs else { unreachable!() };
    let name = fs.name_of(&path);
    let dir = std::env::temp_dir().join("WLT").join("edit").join(short_hash(&id));
    tokio::fs::create_dir_all(&dir).await.map_err(|e| io_err(&dir.to_string_lossy(), e))?;
    let local = dir.join(&name);
    {
        let mut reader = fs.reader(&path).await?;
        let mut writer = tokio::fs::File::create(&local).await.map_err(|e| io_err(&name, e))?;
        tokio::io::copy(&mut reader, &mut writer).await.map_err(|e| io_err(&path, e))?;
        writer.shutdown().await.map_err(|e| io_err(&name, e))?;
    }

    let task = tauri::async_runtime::spawn(watch_edit(app.clone(), id.clone(), sftp.clone(), path.clone(), local.clone()));
    let edit = Edit { conn_id: conn_id.clone(), name, remote_path: path, local_path: local.clone(), task };
    emit_edit(&app, &id, &edit, "watching", None);
    if let Some(old) = app.state::<EditManager>().edits.lock().unwrap().insert(id, edit) {
        old.task.abort();
    }
    Ok(local.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn fs_stop_edit(app: AppHandle, id: String) -> Result<(), String> {
    app.state::<EditManager>().stop(&app, &id);
    Ok(())
}

/// Opens a local file with its default app (or a folder in Explorer).
#[tauri::command]
pub async fn fs_open(path: String) -> Result<(), String> {
    std::process::Command::new("explorer.exe")
        .arg(&path)
        .spawn()
        .map(drop)
        .map_err(|e| format!("cannot open {path}: {e}"))
}

/// Shows a local file selected in Explorer.
#[tauri::command]
pub async fn fs_reveal(path: String) -> Result<(), String> {
    let mut cmd = std::process::Command::new("explorer.exe");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // explorer parses /select itself, so the path is quoted inside the argument.
        cmd.raw_arg(format!("/select,\"{path}\""));
    }
    cmd.spawn().map(drop).map_err(|e| format!("cannot open Explorer: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_paths() {
        assert!(is_within(&Fs::Local, r"C:\Data\Sub", r"c:\data"));
        assert!(same_path(&Fs::Local, r"C:\Data\", r"c:\data"));
        assert!(!is_within(&Fs::Local, r"C:\Database", r"C:\Data"));
        assert_eq!(Fs::Local.parent_of(r"C:\"), Some(String::new()));
        assert_eq!(Fs::Local.parent_of(""), None);
        assert_eq!(Fs::Local.name_of(r"C:\a\b.txt"), "b.txt");
    }

    #[test]
    fn text_encodings_round_trip() {
        let korean = "한글 테스트\r\nline 2";
        for enc in ["utf-8", "utf-8-bom", "euc-kr"] {
            let bytes = encode_text(korean, enc);
            let (text, detected) = decode_text(&bytes).unwrap();
            assert_eq!((text.as_str(), detected), (korean, enc), "{enc}");
        }
        // CP949 bytes are not valid UTF-8, so they're detected as EUC-KR.
        assert_eq!(decode_text(&[0xc7, 0xd1, 0xb1, 0xdb]).unwrap(), ("한글".to_string(), "euc-kr"));
        assert!(decode_text(b"MZ\0\0binary").unwrap_err().starts_with("BINARY"));
    }

    fn s(p: &Path) -> String {
        p.to_string_lossy().into_owned()
    }

    async fn copy(paths: &[String], dst: &Path, mode: TransferMode) -> Result<Vec<String>, String> {
        let cancel = AtomicBool::new(false);
        transfer(&Fs::Local, &Fs::Local, true, "t", &cancel, paths, &s(dst), mode, &|_| {}).await
    }

    #[tokio::test]
    async fn local_transfer_and_edit() {
        let root = std::env::temp_dir().join(format!("wlt-files-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let (src, dst) = (root.join("src"), root.join("dst"));
        std::fs::create_dir_all(src.join("sub")).unwrap();
        std::fs::create_dir_all(&dst).unwrap();
        std::fs::write(src.join("a.txt"), "hello").unwrap();
        std::fs::write(src.join("sub").join("b.bin"), vec![7u8; 600_000]).unwrap(); // > one 256 KiB buffer

        // Folder copy keeps the tree; a second copy gets a " copy" name instead of overwriting.
        let first = copy(&[s(&src)], &dst, TransferMode::Copy).await.unwrap();
        let second = copy(&[s(&src)], &dst, TransferMode::Copy).await.unwrap();
        assert_eq!(first, [s(&dst.join("src"))]);
        assert_eq!(second, [s(&dst.join("src copy"))]);
        assert_eq!(std::fs::read(dst.join("src copy").join("sub").join("b.bin")).unwrap().len(), 600_000);

        // Pasting a file into its own folder → "a copy.txt", then "a copy 2.txt".
        let a = s(&src.join("a.txt"));
        copy(&[a.clone()], &src, TransferMode::Copy).await.unwrap();
        let again = copy(&[a.clone()], &src, TransferMode::Copy).await.unwrap();
        assert_eq!(again, [s(&src.join("a copy 2.txt"))]);

        // A folder can't go into itself; moving into the same folder is a no-op.
        assert!(copy(&[s(&src)], &src.join("sub"), TransferMode::Copy).await.is_err());
        assert!(copy(&[a.clone()], &src, TransferMode::Move).await.unwrap().is_empty());

        // Move = rename on the same disk.
        copy(&[a.clone()], &dst, TransferMode::Move).await.unwrap();
        assert!(!src.join("a.txt").exists());
        assert_eq!(std::fs::read_to_string(dst.join("a.txt")).unwrap(), "hello");

        // Listing: folders first, then case-insensitive names.
        let names: Vec<_> = Fs::Local.list(&s(&src)).await.unwrap().into_iter().map(|e| e.name).collect();
        assert_eq!(names, ["sub", "a copy 2.txt", "a copy.txt"]);

        // Create / rename / delete.
        let fs = Fs::Local;
        fs.create_file(&s(&src.join("new.txt"))).await.unwrap();
        assert!(fs.create_file(&s(&src.join("new.txt"))).await.is_err());
        fs.rename(&s(&src.join("new.txt")), &s(&src.join("renamed.txt"))).await.unwrap();
        assert!(fs.validate_name("a:b").is_err() && fs.validate_name("..").is_err());
        fs.remove_all(&s(&dst)).await.unwrap();
        assert!(!dst.exists());

        let _ = std::fs::remove_dir_all(&root);
    }
}
