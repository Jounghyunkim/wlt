//! Find in files for the sidebar search view.
//!
//! Local folders are walked here and matched with `regex`. On a server,
//! reading every file over SFTP would be slow, so `grep` runs there instead
//! (an exec channel on the tab's SSH connection) and only results come back.
//! Matches are streamed per file as `fs-search` events.

use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use globset::{Glob, GlobSet, GlobSetBuilder};
use regex::{Regex, RegexBuilder};
use russh::ChannelMsg;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::files::{decode_text, FsTarget, SftpManager};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchOptions {
    pub query: String,
    pub case_sensitive: bool,
    pub whole_word: bool,
    pub regex: bool,
    /// Comma-separated globs, e.g. `*.rs, src/**`. Empty = everything.
    #[serde(default)]
    pub include: String,
    /// Comma-separated globs added to the built-in excludes (.git, node_modules, …).
    #[serde(default)]
    pub exclude: String,
    pub max_results: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    /// 1-based.
    line: u32,
    /// 1-based, in characters (for the editor).
    column: u32,
    length: u32,
    /// The line (shortened around the match when long).
    text: String,
    /// Where the match starts within `text`, in characters.
    text_offset: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMatches {
    path: String,
    matches: Vec<SearchMatch>,
}

#[derive(Clone, Serialize)]
struct SearchEvent {
    id: String,
    file: FileMatches,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchSummary {
    files: usize,
    matches: usize,
    /// Files actually read (local search only).
    searched: usize,
    /// Stopped at `max_results`.
    truncated: bool,
    cancelled: bool,
}

/// Folders nobody wants in results; skipped unless named in "include".
const SKIP_DIRS: &[&str] = &[
    ".git", ".svn", ".hg", "node_modules", "target", "dist", "build", ".venv", "venv", "__pycache__",
    ".idea", ".vscode", ".cache", ".next", ".gradle",
];
/// Bigger files are skipped (logs, dumps…).
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
const PREVIEW_CHARS: usize = 200;

fn build_regex(o: &SearchOptions) -> Result<Regex, String> {
    let pattern = if o.regex { o.query.clone() } else { regex::escape(&o.query) };
    let pattern = if o.whole_word { format!(r"\b(?:{pattern})\b") } else { pattern };
    RegexBuilder::new(&pattern)
        .case_insensitive(!o.case_sensitive)
        .build()
        .map_err(|e| format!("잘못된 정규식: {e}"))
}

fn split_globs(list: &str) -> Vec<String> {
    list.split(',').map(str::trim).filter(|g| !g.is_empty()).map(str::to_string).collect()
}

/// Globs match the path relative to the search folder; a bare name (`*.log`,
/// `logs`) matches at any depth, like VS Code's include / exclude boxes.
fn glob_set(list: &str) -> Result<Option<GlobSet>, String> {
    let globs = split_globs(list);
    if globs.is_empty() {
        return Ok(None);
    }
    let mut builder = GlobSetBuilder::new();
    for g in globs {
        let g = g.replace('\\', "/");
        let patterns = if g.contains('/') { vec![g.clone()] } else { vec![format!("**/{g}"), format!("**/{g}/**")] };
        for p in patterns {
            builder.add(Glob::new(&p).map_err(|e| format!("잘못된 패턴 '{g}': {e}"))?);
        }
    }
    builder.build().map(Some).map_err(|e| e.to_string())
}

/// All matches in one line, as character columns.
fn line_matches(re: &Regex, line_no: u32, line: &str) -> Vec<SearchMatch> {
    re.find_iter(line)
        .filter(|m| !m.as_str().is_empty())
        .map(|m| {
            let col = line[..m.start()].chars().count();
            let len = m.as_str().chars().count();
            // Long lines (minified files…) are cut down around the match.
            let start = col.saturating_sub(40);
            let text: String = line.chars().skip(start).take(PREVIEW_CHARS).collect();
            SearchMatch {
                line: line_no,
                column: col as u32 + 1,
                length: len as u32,
                text: if start > 0 { format!("…{text}") } else { text },
                text_offset: (col - start + usize::from(start > 0)) as u32,
            }
        })
        .collect()
}

// ── Local ───────────────────────────────────────────────────────────────────

fn search_local(
    root: &Path,
    re: &Regex,
    include: Option<&GlobSet>,
    exclude: Option<&GlobSet>,
    max: usize,
    cancel: &AtomicBool,
    emit: &(dyn Fn(FileMatches) + Sync),
) -> SearchSummary {
    let mut summary = SearchSummary::default();
    let rel = |p: &Path| p.strip_prefix(root).unwrap_or(p).to_string_lossy().replace('\\', "/");
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        let mut entries: Vec<_> = entries.flatten().collect();
        entries.sort_by_key(|e| e.file_name());
        let mut subdirs = Vec::new();
        for entry in entries {
            if cancel.load(Ordering::Relaxed) {
                summary.cancelled = true;
                return summary;
            }
            let path = entry.path();
            let Ok(kind) = entry.file_type() else { continue };
            let r = rel(&path);
            if exclude.is_some_and(|g| g.is_match(&r)) {
                continue;
            }
            if kind.is_dir() {
                let name = entry.file_name().to_string_lossy().into_owned();
                if !SKIP_DIRS.contains(&name.as_str()) {
                    subdirs.push(path);
                }
                continue;
            }
            if !kind.is_file() || include.is_some_and(|g| !g.is_match(&r)) {
                continue;
            }
            if entry.metadata().map_or(true, |m| m.len() > MAX_FILE_BYTES) {
                continue;
            }
            let Ok(bytes) = std::fs::read(&path) else { continue };
            let Ok((text, _)) = decode_text(&bytes) else { continue }; // binary
            summary.searched += 1;
            let mut matches = Vec::new();
            for (i, line) in text.lines().enumerate() {
                matches.extend(line_matches(re, i as u32 + 1, line));
                if summary.matches + matches.len() >= max {
                    break;
                }
            }
            if !matches.is_empty() {
                matches.truncate(max - summary.matches);
                summary.matches += matches.len();
                summary.files += 1;
                emit(FileMatches { path: path.to_string_lossy().into_owned(), matches });
                if summary.matches >= max {
                    summary.truncated = true;
                    return summary;
                }
            }
        }
        // Depth-first in name order (stack is LIFO).
        stack.extend(subdirs.into_iter().rev());
    }
    summary
}

// ── Remote (grep on the server) ─────────────────────────────────────────────

fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

fn grep_command(dir: &str, o: &SearchOptions, max: usize) -> String {
    // -r recursive, -n line numbers, -I skip binaries, -H file names, -Z NUL after
    // the file name (names may contain ':'), -s quiet about unreadable files.
    let mut cmd = String::from("grep -rnIHZs --color=never");
    if !o.case_sensitive {
        cmd.push_str(" -i");
    }
    if o.whole_word {
        cmd.push_str(" -w");
    }
    cmd.push_str(if o.regex { " -E" } else { " -F" });
    for d in SKIP_DIRS {
        cmd.push_str(&format!(" --exclude-dir={}", sh_quote(d)));
    }
    for g in split_globs(&o.include) {
        cmd.push_str(&format!(" --include={}", sh_quote(&g)));
    }
    for g in split_globs(&o.exclude) {
        cmd.push_str(&format!(" --exclude={0} --exclude-dir={0}", sh_quote(&g)));
    }
    cmd.push_str(&format!(" -e {} -- {} | head -n {}", sh_quote(&o.query), sh_quote(dir), max + 1));
    cmd
}

async fn search_remote(
    app: &AppHandle,
    conn_id: &str,
    dir: &str,
    o: &SearchOptions,
    re: &Regex,
    max: usize,
    cancel: &AtomicBool,
    emit: &(dyn Fn(FileMatches) + Sync),
) -> Result<SearchSummary, String> {
    let handle = app
        .state::<SftpManager>()
        .handle(conn_id)
        .ok_or("SSH connection is not available (tab closed or disconnected)")?;
    let mut channel = handle.channel_open_session().await.map_err(|e| format!("cannot open SSH channel: {e}"))?;
    channel.exec(true, grep_command(dir, o, max)).await.map_err(|e| format!("cannot run grep: {e}"))?;

    let mut summary = SearchSummary::default();
    let mut current: Option<FileMatches> = None;
    let mut pending = Vec::<u8>::new();
    let mut stderr = Vec::<u8>::new();
    let mut exit: Option<u32> = None;
    let flush = |file: Option<FileMatches>, summary: &mut SearchSummary| {
        if let Some(f) = file.filter(|f| !f.matches.is_empty()) {
            summary.files += 1;
            emit(f);
        }
    };

    loop {
        if cancel.load(Ordering::Relaxed) {
            let _ = channel.close().await;
            summary.cancelled = true;
            break;
        }
        let Some(msg) = channel.wait().await else { break };
        match msg {
            ChannelMsg::Data { data } => {
                pending.extend_from_slice(&data);
                // Complete lines: "<path>\0<line>:<text>".
                while let Some(nl) = pending.iter().position(|&b| b == b'\n') {
                    let raw: Vec<u8> = pending.drain(..=nl).collect();
                    let line = String::from_utf8_lossy(&raw[..raw.len() - 1]).into_owned();
                    let Some((path, rest)) = line.split_once('\0') else { continue };
                    let Some((no, text)) = rest.split_once(':') else { continue };
                    let Ok(no) = no.parse::<u32>() else { continue };
                    if summary.matches >= max {
                        summary.truncated = true;
                        continue;
                    }
                    if current.as_ref().is_some_and(|c| c.path != path) {
                        flush(current.take(), &mut summary);
                    }
                    let file = current.get_or_insert_with(|| FileMatches { path: path.to_string(), matches: Vec::new() });
                    // grep found the line; the editor still needs columns (POSIX ERE ≈ Rust regex).
                    let mut found = line_matches(re, no, text);
                    if found.is_empty() {
                        found = line_matches(&Regex::new("^").unwrap(), no, text);
                        found.iter_mut().for_each(|m| m.length = 0);
                        if found.is_empty() {
                            found.push(SearchMatch { line: no, column: 1, length: 0, text: text.chars().take(PREVIEW_CHARS).collect(), text_offset: 0 });
                        }
                    }
                    found.truncate(max - summary.matches);
                    summary.matches += found.len();
                    file.matches.extend(found);
                }
            }
            ChannelMsg::ExtendedData { data, .. } => stderr.extend_from_slice(&data),
            ChannelMsg::ExitStatus { exit_status } => exit = Some(exit_status),
            ChannelMsg::Eof | ChannelMsg::Close => {
                if matches!(msg, ChannelMsg::Close) {
                    break;
                }
            }
            _ => {}
        }
    }
    flush(current.take(), &mut summary);
    // grep: 0 = matches, 1 = none, 2 = error (ignored when piped through head); 127 = not installed.
    if exit == Some(127) {
        return Err("서버에 grep이 없어 검색할 수 없습니다".into());
    }
    if summary.matches == 0 && !stderr.is_empty() && exit.is_some_and(|c| c > 1) {
        return Err(String::from_utf8_lossy(&stderr).trim().to_string());
    }
    Ok(summary)
}

// ── Commands ────────────────────────────────────────────────────────────────

#[derive(Default)]
pub struct SearchManager {
    cancels: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

/// Searches `dir` on `target`; matches arrive as `fs-search` events, the summary as the result.
#[tauri::command]
pub async fn fs_search(
    app: AppHandle,
    searches: tauri::State<'_, SearchManager>,
    id: String,
    target: FsTarget,
    dir: String,
    options: SearchOptions,
) -> Result<SearchSummary, String> {
    if options.query.is_empty() {
        return Ok(SearchSummary::default());
    }
    let re = build_regex(&options)?;
    let max = options.max_results.clamp(1, 20_000);
    let cancel = Arc::new(AtomicBool::new(false));
    searches.cancels.lock().unwrap().insert(id.clone(), cancel.clone());
    let emit = {
        let (app, id) = (app.clone(), id.clone());
        move |file: FileMatches| {
            let _ = app.emit("fs-search", SearchEvent { id: id.clone(), file });
        }
    };

    let result = match &target {
        FsTarget::Local => {
            let include = glob_set(&options.include)?;
            let exclude = glob_set(&options.exclude)?;
            let cancel = cancel.clone();
            tauri::async_runtime::spawn_blocking(move || {
                search_local(Path::new(&dir), &re, include.as_ref(), exclude.as_ref(), max, &cancel, &emit)
            })
            .await
            .map_err(|e| e.to_string())
        }
        FsTarget::Ssh { conn_id } => search_remote(&app, conn_id, &dir, &options, &re, max, &cancel, &emit).await,
    };
    searches.cancels.lock().unwrap().remove(&id);
    result
}

#[tauri::command]
pub async fn fs_search_cancel(searches: tauri::State<'_, SearchManager>, id: String) -> Result<(), String> {
    if let Some(flag) = searches.cancels.lock().unwrap().get(&id) {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opts(query: &str) -> SearchOptions {
        SearchOptions {
            query: query.into(),
            case_sensitive: false,
            whole_word: false,
            regex: false,
            include: String::new(),
            exclude: String::new(),
            max_results: 1000,
        }
    }

    #[test]
    fn local_search_finds_matches_and_skips_noise() {
        let root = std::env::temp_dir().join(format!("wlt-search-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        std::fs::write(root.join("src/main.rs"), "fn main() {\n    println!(\"Hello 한글\");\n    hello();\n}\n").unwrap();
        std::fs::write(root.join("notes.txt"), "say HELLO twice: hello\n").unwrap();
        std::fs::write(root.join("node_modules/pkg/index.js"), "hello from deps\n").unwrap();
        std::fs::write(root.join("blob.bin"), b"hello\0\0binary").unwrap();
        std::fs::write(root.join("legacy.txt"), encoding_rs::EUC_KR.encode("안녕 hello 세계").0).unwrap();

        let run = |o: &SearchOptions| {
            let re = build_regex(o).unwrap();
            let found = Mutex::new(Vec::new());
            let s = search_local(
                &root,
                &re,
                glob_set(&o.include).unwrap().as_ref(),
                glob_set(&o.exclude).unwrap().as_ref(),
                o.max_results,
                &AtomicBool::new(false),
                &|f| found.lock().unwrap().push(f),
            );
            (s, found.into_inner().unwrap())
        };
        let name = |f: &FileMatches| Path::new(&f.path).file_name().unwrap().to_string_lossy().into_owned();

        // Case-insensitive: 5 matches in 3 files; node_modules and the binary are skipped.
        let (s, files) = run(&opts("hello"));
        let mut names: Vec<_> = files.iter().map(name).collect();
        names.sort();
        assert_eq!(names, ["legacy.txt", "main.rs", "notes.txt"]);
        assert_eq!(s.matches, 5);
        // Columns are in characters (Korean before the match counts as 1 each).
        let legacy = files.iter().find(|f| name(f) == "legacy.txt").unwrap();
        assert_eq!((legacy.matches[0].column, legacy.matches[0].length), (4, 5));

        // Case-sensitive + whole word + include filter.
        let o = SearchOptions { case_sensitive: true, whole_word: true, include: "*.txt".into(), ..opts("hello") };
        let (s, files) = run(&o);
        assert_eq!((s.matches, files.len()), (2, 2)); // notes.txt "hello", legacy.txt "hello"

        // Regex, exclude, and the result cap.
        let o = SearchOptions { regex: true, exclude: "notes.txt".into(), ..opts(r"hel+o\(") };
        assert_eq!(run(&o).0.matches, 1); // hello( in main.rs
        let o = SearchOptions { max_results: 2, ..opts("hello") };
        let (s, _) = run(&o);
        assert!(s.truncated && s.matches == 2);

        assert!(build_regex(&SearchOptions { regex: true, ..opts("(") }).is_err());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn grep_command_quotes_everything() {
        let o = SearchOptions { include: "*.py".into(), ..opts("it's") };
        let cmd = grep_command("/srv/my app", &o, 100);
        assert!(cmd.contains(r"-e 'it'\''s' -- '/srv/my app' | head -n 101"), "{cmd}");
        assert!(cmd.contains("-F") && cmd.contains("-i") && cmd.contains("--include='*.py'"));
    }
}
