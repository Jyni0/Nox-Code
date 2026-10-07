//! File system operations behind the explorer, tabs and file finder.

use std::fs;
use std::io::Write;
use std::path::Path;

use serde::Serialize;

use crate::error::{AppError, AppResult};

/// Files above this size are refused instead of freezing the editor.
pub const MAX_OPEN_BYTES: u64 = 32 * 1024 * 1024;
/// How far into a file we look for NUL bytes to call it binary.
const BINARY_SNIFF: usize = 8000;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    pub content: String,
    pub binary: bool,
    pub size: u64,
    /// "LF" or "CRLF" — the editor works in LF and converts back on save.
    pub line_ending: String,
    /// The file started with a UTF-8 BOM (kept on save).
    pub bom: bool,
}

fn path_string(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

/// Lists one directory: folders first, then files, both case-insensitively.
pub fn list_dir(path: &Path) -> AppResult<Vec<DirEntry>> {
    let mut out = Vec::new();
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let ft = entry.file_type()?;
        let p = entry.path();
        // Follow symlinks for the dir/file decision, but remember they are links.
        let meta = fs::metadata(&p).ok();
        let is_dir = meta.as_ref().map(|m| m.is_dir()).unwrap_or(ft.is_dir());
        out.push(DirEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            path: path_string(&p),
            is_dir,
            is_symlink: ft.is_symlink(),
            size: meta.map(|m| if m.is_file() { m.len() } else { 0 }).unwrap_or(0),
        });
    }
    sort_entries(&mut out);
    Ok(out)
}

pub fn sort_entries(entries: &mut [DirEntry]) {
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
            .then_with(|| a.name.cmp(&b.name))
    });
}

pub fn is_binary(bytes: &[u8]) -> bool {
    bytes.iter().take(BINARY_SNIFF).any(|&b| b == 0)
}

pub fn read_file(path: &Path) -> AppResult<FileContent> {
    let meta = fs::metadata(path)?;
    if meta.is_dir() {
        return Err(AppError::msg("Cannot open a folder as a file"));
    }
    let size = meta.len();
    if size > MAX_OPEN_BYTES {
        return Err(AppError::msg(format!(
            "File is too large to open ({:.1} MB, limit {} MB)",
            size as f64 / 1_048_576.0,
            MAX_OPEN_BYTES / 1_048_576
        )));
    }
    let bytes = fs::read(path)?;
    if is_binary(&bytes) {
        return Ok(FileContent { content: String::new(), binary: true, size, line_ending: "LF".into(), bom: false });
    }
    let (bom, body) = match bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        Some(rest) => (true, rest),
        None => (false, &bytes[..]),
    };
    let text = String::from_utf8_lossy(body).into_owned();
    let line_ending = if text.contains("\r\n") { "CRLF" } else { "LF" };
    Ok(FileContent { content: text, binary: false, size, line_ending: line_ending.into(), bom })
}

/// Normalises any line breaks to LF, then to the requested ending.
pub fn apply_line_ending(content: &str, line_ending: &str) -> String {
    let lf = content.replace("\r\n", "\n");
    if line_ending.eq_ignore_ascii_case("CRLF") {
        lf.replace('\n', "\r\n")
    } else {
        lf
    }
}

pub fn write_file(path: &Path, content: &str, line_ending: &str, bom: bool) -> AppResult<()> {
    let body = apply_line_ending(content, line_ending);
    let mut f = fs::File::create(path)?;
    if bom {
        f.write_all(&[0xEF, 0xBB, 0xBF])?;
    }
    f.write_all(body.as_bytes())?;
    f.flush()?;
    Ok(())
}

/// Raw bytes as base64 (image preview). Capped like text files.
pub fn read_base64(path: &Path) -> AppResult<String> {
    use base64::Engine;
    let size = fs::metadata(path)?.len();
    if size > MAX_OPEN_BYTES {
        return Err(AppError::msg("File is too large to preview"));
    }
    Ok(base64::engine::general_purpose::STANDARD.encode(fs::read(path)?))
}

pub fn create_file(path: &Path) -> AppResult<()> {
    if path.exists() {
        return Err(AppError::msg(format!("'{}' already exists", file_name(path))));
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::OpenOptions::new().write(true).create_new(true).open(path)?;
    Ok(())
}

pub fn create_dir(path: &Path) -> AppResult<()> {
    if path.exists() {
        return Err(AppError::msg(format!("'{}' already exists", file_name(path))));
    }
    fs::create_dir_all(path)?;
    Ok(())
}

pub fn rename(from: &Path, to: &Path) -> AppResult<()> {
    if !from.exists() {
        return Err(AppError::msg(format!("'{}' does not exist", file_name(from))));
    }
    // A case-only rename on Windows reports `to` as existing — allow it.
    let same = from.to_string_lossy().to_lowercase() == to.to_string_lossy().to_lowercase();
    if to.exists() && !same {
        return Err(AppError::msg(format!("'{}' already exists", file_name(to))));
    }
    fs::rename(from, to)?;
    Ok(())
}

/// Copies a file or a whole folder next to itself ("Duplicate").
pub fn copy_path(from: &Path, to: &Path) -> AppResult<()> {
    if to.exists() {
        return Err(AppError::msg(format!("'{}' already exists", file_name(to))));
    }
    if from.is_dir() {
        fs::create_dir_all(to)?;
        for entry in fs::read_dir(from)? {
            let entry = entry?;
            copy_path(&entry.path(), &to.join(entry.file_name()))?;
        }
    } else {
        fs::copy(from, to)?;
    }
    Ok(())
}

/// Deletes a file or folder; `to_trash` moves it to the Recycle Bin instead.
pub fn delete(path: &Path, to_trash: bool) -> AppResult<()> {
    if !path.exists() {
        return Ok(());
    }
    if to_trash {
        trash::delete(path).map_err(|e| AppError::msg(format!("Could not move to trash: {e}")))?;
    } else if path.is_dir() {
        fs::remove_dir_all(path)?;
    } else {
        fs::remove_file(path)?;
    }
    Ok(())
}

/// Every file of a project (relative, forward slashes), honouring .gitignore.
pub fn list_files(root: &Path, max: usize) -> AppResult<Vec<String>> {
    let mut out = Vec::new();
    let walker = ignore::WalkBuilder::new(root)
        .hidden(false)
        .git_ignore(true)
        .git_global(false)
        .git_exclude(true)
        .require_git(false)
        .filter_entry(|e| e.file_name() != ".git")
        .build();
    for entry in walker {
        let Ok(entry) = entry else { continue };
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        if let Ok(rel) = entry.path().strip_prefix(root) {
            out.push(rel.to_string_lossy().replace('\\', "/"));
        }
        if out.len() >= max {
            break;
        }
    }
    out.sort();
    Ok(out)
}

fn file_name(p: &Path) -> String {
    p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path_string(p))
}
