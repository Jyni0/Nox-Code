//! Git integration through the `git` CLI (status, gutter base, stage, commit).

use std::path::Path;
use std::process::{Command, Output};

use serde::Serialize;

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitFile {
    /// Path relative to the repository root, forward slashes.
    pub path: String,
    /// One letter: M modified, A added, D deleted, R renamed, ? untracked, U conflict.
    pub status: String,
    /// The change is in the index.
    pub staged: bool,
    /// Also has unstaged changes on top of the staged ones.
    pub unstaged: bool,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitInfo {
    pub is_repo: bool,
    pub branch: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub files: Vec<GitFile>,
}

pub fn git(root: &Path) -> Command {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(root).arg("-c").arg("core.quotepath=false");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

fn run(mut cmd: Command) -> AppResult<Output> {
    let out = cmd.output().map_err(|e| AppError::msg(format!("git is not available: {e}")))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(AppError::msg(if err.is_empty() { "git command failed".to_string() } else { err }));
    }
    Ok(out)
}

/// Parses the `## branch...upstream [ahead 1, behind 2]` header line.
pub fn parse_branch_line(line: &str) -> (Option<String>, u32, u32) {
    let rest = line.trim_start_matches("## ").trim();
    if let Some(b) = rest.strip_prefix("No commits yet on ") {
        return (Some(b.trim().to_string()), 0, 0);
    }
    if rest.starts_with("HEAD (no branch)") {
        return (Some("HEAD".into()), 0, 0);
    }
    let (names, counts) = match rest.find(" [") {
        Some(i) => (&rest[..i], &rest[i + 2..rest.len().saturating_sub(1)]),
        None => (rest, ""),
    };
    let branch = names.split("...").next().unwrap_or(names).to_string();
    let mut ahead = 0;
    let mut behind = 0;
    for part in counts.split(',') {
        let part = part.trim();
        if let Some(n) = part.strip_prefix("ahead ") {
            ahead = n.parse().unwrap_or(0);
        } else if let Some(n) = part.strip_prefix("behind ") {
            behind = n.parse().unwrap_or(0);
        }
    }
    (Some(branch), ahead, behind)
}

fn unquote(p: &str) -> String {
    let p = p.trim();
    if p.len() >= 2 && p.starts_with('"') && p.ends_with('"') {
        p[1..p.len() - 1].replace("\\\"", "\"").replace("\\\\", "\\")
    } else {
        p.to_string()
    }
}

/// Parses `git status --porcelain=v1 -b` output.
pub fn parse_status(out: &str) -> GitInfo {
    let mut info = GitInfo { is_repo: true, ..Default::default() };
    for line in out.lines() {
        if line.starts_with("## ") {
            let (b, a, bh) = parse_branch_line(line);
            info.branch = b;
            info.ahead = a;
            info.behind = bh;
            continue;
        }
        if line.len() < 4 {
            continue;
        }
        let bytes = line.as_bytes();
        let (x, y) = (bytes[0] as char, bytes[1] as char);
        let raw = &line[3..];
        let path = match raw.find(" -> ") {
            Some(i) => unquote(&raw[i + 4..]),
            None => unquote(raw),
        };
        let conflict = x == 'U' || y == 'U' || (x == 'A' && y == 'A') || (x == 'D' && y == 'D');
        let (status, staged, unstaged) = if x == '?' {
            ("?".to_string(), false, true)
        } else if x == '!' {
            continue;
        } else if conflict {
            ("U".to_string(), false, true)
        } else {
            let letter = if x != ' ' { x } else { y };
            (letter.to_string(), x != ' ', y != ' ')
        };
        info.files.push(GitFile { path, status, staged, unstaged });
    }
    info
}

pub fn info(root: &Path) -> GitInfo {
    let mut cmd = git(root);
    cmd.args(["status", "--porcelain=v1", "-b", "--untracked-files=all"]);
    match run(cmd) {
        Ok(out) => parse_status(&String::from_utf8_lossy(&out.stdout)),
        Err(_) => GitInfo::default(),
    }
}

/// The file's content at HEAD (base of the gutter diff); None when untracked.
pub fn head_content(root: &Path, rel: &str) -> Option<String> {
    let mut cmd = git(root);
    cmd.arg("show").arg(format!("HEAD:{}", rel.replace('\\', "/")));
    let out = run(cmd).ok()?;
    if crate::fsops::is_binary(&out.stdout) {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).replace("\r\n", "\n"))
}

pub fn stage(root: &Path, paths: &[String]) -> AppResult<()> {
    let mut cmd = git(root);
    cmd.args(["add", "-A", "--"]).args(paths);
    run(cmd).map(|_| ())
}

pub fn unstage(root: &Path, paths: &[String]) -> AppResult<()> {
    let mut cmd = git(root);
    cmd.args(["reset", "-q", "HEAD", "--"]).args(paths);
    // A repo without commits has no HEAD: fall back to removing from the index.
    run(cmd).or_else(|_| {
        let mut rm = git(root);
        rm.args(["rm", "--cached", "-q", "-r", "--"]).args(paths);
        run(rm)
    })?;
    Ok(())
}

/// Throws away working-tree changes of tracked files.
pub fn discard(root: &Path, paths: &[String]) -> AppResult<()> {
    let mut cmd = git(root);
    cmd.args(["checkout", "--"]).args(paths);
    run(cmd).map(|_| ())
}

pub fn commit(root: &Path, message: &str) -> AppResult<()> {
    if message.trim().is_empty() {
        return Err(AppError::msg("Commit message is empty"));
    }
    let mut cmd = git(root);
    cmd.args(["commit", "-q", "-m", message]);
    run(cmd).map(|_| ())
}

pub fn init(root: &Path) -> AppResult<()> {
    let mut cmd = git(root);
    cmd.args(["init", "-q"]);
    run(cmd).map(|_| ())
}
