//! Project-wide find & replace (the Search panel).

use std::fs;
use std::path::Path;

use ignore::overrides::{Override, OverrideBuilder};
use regex::{NoExpand, Regex, RegexBuilder};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::fsops::is_binary;

const MAX_SEARCH_FILE: u64 = 8 * 1024 * 1024;
const PREVIEW_CHARS: usize = 400;

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SearchOptions {
    pub query: String,
    pub regex: bool,
    pub case_sensitive: bool,
    pub whole_word: bool,
    /// Comma separated globs: only files matching one of them are searched.
    pub include: String,
    /// Comma separated globs that are skipped.
    pub exclude: String,
    pub max_results: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    /// 1-based line number.
    pub line: u32,
    /// Start of the match in UTF-16 code units from the line start (what CodeMirror counts).
    pub col: u32,
    /// Length of the match in UTF-16 code units.
    pub len: u32,
    pub preview: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchFile {
    pub path: String,
    pub rel: String,
    pub matches: Vec<SearchMatch>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub files: Vec<SearchFile>,
    pub total_matches: usize,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceResult {
    pub files_changed: usize,
    pub replacements: usize,
}

pub fn build_regex(opts: &SearchOptions) -> AppResult<Regex> {
    if opts.query.is_empty() {
        return Err(AppError::msg("Empty search query"));
    }
    let base = if opts.regex { opts.query.clone() } else { regex::escape(&opts.query) };
    let pattern = if opts.whole_word { format!(r"\b(?:{base})\b") } else { base };
    Ok(RegexBuilder::new(&pattern)
        .case_insensitive(!opts.case_sensitive)
        .multi_line(true)
        .size_limit(20 * 1024 * 1024)
        .build()?)
}

fn split_globs(s: &str) -> impl Iterator<Item = &str> {
    s.split(',').map(str::trim).filter(|g| !g.is_empty())
}

pub fn build_overrides(root: &Path, include: &str, exclude: &str) -> AppResult<Override> {
    let mut b = OverrideBuilder::new(root);
    for g in split_globs(include) {
        b.add(g)?;
    }
    for g in split_globs(exclude) {
        b.add(&format!("!{g}"))?;
    }
    Ok(b.build()?)
}

fn walker(root: &Path, opts: &SearchOptions) -> AppResult<ignore::Walk> {
    let overrides = build_overrides(root, &opts.include, &opts.exclude)?;
    Ok(ignore::WalkBuilder::new(root)
        .hidden(false)
        .git_ignore(true)
        .git_global(false)
        .require_git(false)
        .overrides(overrides)
        .filter_entry(|e| e.file_name() != ".git")
        .build())
}

fn utf16_len(s: &str) -> u32 {
    s.encode_utf16().count() as u32
}

fn readable_text(path: &Path) -> Option<String> {
    let meta = fs::metadata(path).ok()?;
    if meta.len() > MAX_SEARCH_FILE {
        return None;
    }
    let bytes = fs::read(path).ok()?;
    if is_binary(&bytes) {
        return None;
    }
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

/// Finds every match of `re` in `text`, line by line.
pub fn find_in_text(re: &Regex, text: &str, limit: usize) -> Vec<SearchMatch> {
    let mut out = Vec::new();
    for (i, raw) in text.split('\n').enumerate() {
        let line = raw.strip_suffix('\r').unwrap_or(raw);
        for m in re.find_iter(line) {
            if m.start() == m.end() {
                continue;
            }
            let preview: String = line.chars().take(PREVIEW_CHARS).collect();
            out.push(SearchMatch {
                line: i as u32 + 1,
                col: utf16_len(&line[..m.start()]),
                len: utf16_len(m.as_str()),
                preview,
            });
            if out.len() >= limit {
                return out;
            }
        }
    }
    out
}

pub fn search(root: &Path, opts: &SearchOptions) -> AppResult<SearchResult> {
    let re = build_regex(opts)?;
    let max = if opts.max_results == 0 { 5000 } else { opts.max_results };
    let mut files = Vec::new();
    let mut total = 0usize;
    let mut truncated = false;
    for entry in walker(root, opts)? {
        let Ok(entry) = entry else { continue };
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        let Some(text) = readable_text(entry.path()) else { continue };
        let matches = find_in_text(&re, &text, max - total);
        if matches.is_empty() {
            continue;
        }
        total += matches.len();
        let rel = entry.path().strip_prefix(root).unwrap_or(entry.path()).to_string_lossy().replace('\\', "/");
        files.push(SearchFile { path: entry.path().to_string_lossy().into_owned(), rel, matches });
        if total >= max {
            truncated = true;
            break;
        }
    }
    files.sort_by(|a, b| a.rel.cmp(&b.rel));
    Ok(SearchResult { files, total_matches: total, truncated })
}

/// Replaces every match in the project (or only in `only` files when given).
/// In plain-text mode the replacement is literal; in regex mode `$1` works.
pub fn replace_all(root: &Path, opts: &SearchOptions, replacement: &str, only: Option<&[String]>) -> AppResult<ReplaceResult> {
    let re = build_regex(opts)?;
    let mut result = ReplaceResult { files_changed: 0, replacements: 0 };
    for entry in walker(root, opts)? {
        let Ok(entry) = entry else { continue };
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        let path_str = entry.path().to_string_lossy().into_owned();
        if let Some(only) = only {
            if !only.iter().any(|p| Path::new(p) == entry.path() || *p == path_str) {
                continue;
            }
        }
        let Some(text) = readable_text(entry.path()) else { continue };
        let count = re.find_iter(&text).filter(|m| m.start() != m.end()).count();
        if count == 0 {
            continue;
        }
        let next = if opts.regex {
            re.replace_all(&text, replacement).into_owned()
        } else {
            re.replace_all(&text, NoExpand(replacement)).into_owned()
        };
        fs::write(entry.path(), next)?;
        result.files_changed += 1;
        result.replacements += count;
    }
    Ok(result)
}
