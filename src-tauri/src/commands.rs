//! Tauri command layer: thin wrappers over the modules, run off the UI thread.

use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::error::{AppError, AppResult};
use crate::fsops::{self, DirEntry, FileContent};
use crate::git::{self, GitInfo};
use crate::pty::PtyManager;
use crate::search::{self, ReplaceResult, SearchOptions, SearchResult};
use crate::watcher::ProjectWatcher;

#[derive(Default)]
pub struct AppState {
    pub pty: PtyManager,
    pub watcher: ProjectWatcher,
}

/// Runs blocking work on the blocking pool so the IPC thread stays free.
async fn blocking<T, F>(f: F) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> AppResult<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| AppError::msg(e.to_string()))?
}

#[tauri::command]
pub async fn fs_list_dir(path: String) -> AppResult<Vec<DirEntry>> {
    blocking(move || fsops::list_dir(&PathBuf::from(path))).await
}

#[tauri::command]
pub async fn fs_read_file(path: String) -> AppResult<FileContent> {
    blocking(move || fsops::read_file(&PathBuf::from(path))).await
}

#[tauri::command]
pub async fn fs_read_base64(path: String) -> AppResult<String> {
    blocking(move || fsops::read_base64(&PathBuf::from(path))).await
}

#[tauri::command]
pub async fn fs_write_file(path: String, content: String, line_ending: Option<String>, bom: Option<bool>) -> AppResult<()> {
    blocking(move || {
        fsops::write_file(&PathBuf::from(path), &content, line_ending.as_deref().unwrap_or("LF"), bom.unwrap_or(false))
    })
    .await
}

#[tauri::command]
pub async fn fs_create_file(path: String) -> AppResult<()> {
    blocking(move || fsops::create_file(&PathBuf::from(path))).await
}

#[tauri::command]
pub async fn fs_create_dir(path: String) -> AppResult<()> {
    blocking(move || fsops::create_dir(&PathBuf::from(path))).await
}

#[tauri::command]
pub async fn fs_rename(from: String, to: String) -> AppResult<()> {
    blocking(move || fsops::rename(&PathBuf::from(from), &PathBuf::from(to))).await
}

#[tauri::command]
pub async fn fs_copy(from: String, to: String) -> AppResult<()> {
    blocking(move || fsops::copy_path(&PathBuf::from(from), &PathBuf::from(to))).await
}

#[tauri::command]
pub async fn fs_delete(path: String, to_trash: Option<bool>) -> AppResult<()> {
    blocking(move || fsops::delete(&PathBuf::from(path), to_trash.unwrap_or(true))).await
}

#[tauri::command]
pub async fn fs_exists(path: String) -> bool {
    PathBuf::from(path).exists()
}

#[tauri::command]
pub async fn fs_list_files(root: String, max: Option<usize>) -> AppResult<Vec<String>> {
    blocking(move || fsops::list_files(&PathBuf::from(root), max.unwrap_or(100_000))).await
}

#[tauri::command]
pub async fn search_project(root: String, options: SearchOptions) -> AppResult<SearchResult> {
    blocking(move || search::search(&PathBuf::from(root), &options)).await
}

#[tauri::command]
pub async fn replace_project(root: String, options: SearchOptions, replacement: String, files: Option<Vec<String>>) -> AppResult<ReplaceResult> {
    blocking(move || search::replace_all(&PathBuf::from(root), &options, &replacement, files.as_deref())).await
}

#[tauri::command]
pub async fn git_info(root: String) -> AppResult<GitInfo> {
    blocking(move || Ok(git::info(&PathBuf::from(root)))).await
}

#[tauri::command]
pub async fn git_head_content(root: String, rel: String) -> AppResult<Option<String>> {
    blocking(move || Ok(git::head_content(&PathBuf::from(root), &rel))).await
}

#[tauri::command]
pub async fn git_stage(root: String, paths: Vec<String>) -> AppResult<()> {
    blocking(move || git::stage(&PathBuf::from(root), &paths)).await
}

#[tauri::command]
pub async fn git_unstage(root: String, paths: Vec<String>) -> AppResult<()> {
    blocking(move || git::unstage(&PathBuf::from(root), &paths)).await
}

#[tauri::command]
pub async fn git_discard(root: String, paths: Vec<String>) -> AppResult<()> {
    blocking(move || git::discard(&PathBuf::from(root), &paths)).await
}

#[tauri::command]
pub async fn git_commit(root: String, message: String) -> AppResult<()> {
    blocking(move || git::commit(&PathBuf::from(root), &message)).await
}

#[tauri::command]
pub async fn git_init(root: String) -> AppResult<()> {
    blocking(move || git::init(&PathBuf::from(root))).await
}

#[derive(Clone, Serialize)]
struct PtyData {
    id: u32,
    data: String,
}

#[derive(Clone, Serialize)]
struct PtyExit {
    id: u32,
    code: Option<u32>,
}

// Terminal commands run on the blocking pool, never on the main thread:
// ConPTY calls can stall for a moment and must not freeze the window.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn pty_spawn(
    app: AppHandle,
    state: State<'_, AppState>,
    cwd: String,
    cols: u16,
    rows: u16,
    shell: Option<String>,
    args: Option<Vec<String>>,
) -> AppResult<u32> {
    let pty = state.pty.clone();
    blocking(move || {
        let data_app = app.clone();
        pty.spawn(
            &PathBuf::from(cwd),
            cols,
            rows,
            shell,
            args,
            move |id, data| {
                let _ = data_app.emit("pty:data", PtyData { id, data });
            },
            move |id, code| {
                let _ = app.emit("pty:exit", PtyExit { id, code });
            },
        )
    })
    .await
}

#[tauri::command]
pub async fn pty_write(state: State<'_, AppState>, id: u32, data: String) -> AppResult<()> {
    let pty = state.pty.clone();
    blocking(move || pty.write(id, &data)).await
}

#[tauri::command]
pub async fn pty_resize(state: State<'_, AppState>, id: u32, cols: u16, rows: u16) -> AppResult<()> {
    let pty = state.pty.clone();
    blocking(move || pty.resize(id, cols, rows)).await
}

#[tauri::command]
pub async fn pty_kill(state: State<'_, AppState>, id: u32) -> AppResult<()> {
    let pty = state.pty.clone();
    blocking(move || pty.kill(id)).await
}

#[tauri::command]
pub async fn list_shells() -> AppResult<Vec<crate::pty::ShellProfile>> {
    blocking(|| Ok(crate::pty::detect_shells())).await
}

#[tauri::command]
pub fn watch_project(app: AppHandle, state: State<'_, AppState>, root: String) -> AppResult<()> {
    state.watcher.watch(PathBuf::from(root), move |paths| {
        let _ = app.emit("fs:changed", paths);
    })
}

#[tauri::command]
pub fn unwatch_project(state: State<'_, AppState>) {
    state.watcher.stop();
}

/// A folder or file passed on the command line (`noxcode C:\code\app`).
#[tauri::command]
pub fn startup_path() -> Option<String> {
    std::env::args()
        .skip(1)
        .find(|a| !a.starts_with('-'))
        .map(PathBuf::from)
        .filter(|p| p.exists())
        .and_then(|p| p.canonicalize().ok().or(Some(p)))
        .map(|p| p.to_string_lossy().trim_start_matches(r"\\?\").to_string())
}

/// The git checkout this binary was built from, when it is still on this
/// machine: "Update" can then pull and rebuild without a GitHub release.
#[tauri::command]
pub fn source_checkout() -> Option<String> {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent()?.to_path_buf();
    (dir.join(".git").exists() && dir.join("package.json").exists()).then(|| dir.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn default_shell() -> AppResult<String> {
    blocking(|| Ok(crate::pty::default_shell())).await
}
