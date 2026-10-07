//! Integrated terminal: one pseudo-terminal per panel tab.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;

use crate::error::{AppError, AppResult};

/// Each part has its own lock: a slow write to one terminal (ConPTY can
/// block while it waits for the host) never stalls another terminal.
struct Session {
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
}

/// Cheap to clone: commands hand a copy to the blocking pool.
#[derive(Default, Clone)]
pub struct PtyManager {
    sessions: Arc<Mutex<HashMap<u32, Arc<Session>>>>,
    next: Arc<AtomicU32>,
}

/// Turns a byte stream into UTF-8 text without splitting a character that
/// arrives across two reads.
#[derive(Default)]
pub struct Utf8Stream {
    carry: Vec<u8>,
}

impl Utf8Stream {
    pub fn push(&mut self, bytes: &[u8]) -> String {
        self.carry.extend_from_slice(bytes);
        let mut out = String::new();
        loop {
            match std::str::from_utf8(&self.carry) {
                Ok(s) => {
                    out.push_str(s);
                    self.carry.clear();
                    break;
                }
                Err(e) => {
                    let valid = e.valid_up_to();
                    out.push_str(std::str::from_utf8(&self.carry[..valid]).unwrap_or_default());
                    match e.error_len() {
                        // Incomplete sequence at the end: wait for the next read.
                        None => {
                            self.carry.drain(..valid);
                            break;
                        }
                        // Invalid bytes: replace and keep going.
                        Some(n) => {
                            out.push('\u{FFFD}');
                            self.carry.drain(..valid + n);
                        }
                    }
                }
            }
        }
        out
    }
}

/// Device status report: "where is the cursor?"
const CURSOR_QUERY: &str = "\x1b[6n";

fn on_path(exe: &str) -> Option<PathBuf> {
    let paths = std::env::var_os("PATH")?;
    std::env::split_paths(&paths).map(|dir| dir.join(exe)).find(|p| p.is_file())
}

/// A shell the terminal can start: one entry of the "new terminal" menu.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ShellProfile {
    pub id: String,
    pub name: String,
    pub program: String,
    pub args: Vec<String>,
}

fn profile(id: &str, name: &str, program: impl Into<String>, args: &[&str]) -> ShellProfile {
    ShellProfile { id: id.into(), name: name.into(), program: program.into(), args: args.iter().map(|a| a.to_string()).collect() }
}

/// Shells installed on this machine, the default one first.
#[cfg(windows)]
pub fn detect_shells() -> Vec<ShellProfile> {
    let env = |k: &str| std::env::var(k).ok().map(PathBuf::from);
    let roots: Vec<PathBuf> = [env("ProgramFiles"), env("ProgramFiles(x86)"), env("LOCALAPPDATA").map(|p| p.join("Programs"))]
        .into_iter()
        .flatten()
        .collect();
    let find = |rel: &[&str]| roots.iter().map(|r| rel.iter().fold(r.clone(), |p, part| p.join(part))).find(|p| p.is_file());

    let mut out = Vec::new();
    if let Some(p) = on_path("pwsh.exe").or_else(|| find(&["PowerShell", "7", "pwsh.exe"])) {
        out.push(profile("pwsh", "PowerShell", p.to_string_lossy(), &["-NoLogo"]));
    }
    out.push(profile("powershell", "Windows PowerShell", "powershell.exe", &["-NoLogo"]));
    out.push(profile("cmd", "Command Prompt", "cmd.exe", &[]));
    if let Some(p) = find(&["Git", "bin", "bash.exe"]) {
        out.push(profile("git-bash", "Git Bash", p.to_string_lossy(), &["--login", "-i"]));
    }
    if let Some(p) = env("SystemRoot").map(|r| r.join("System32").join("wsl.exe")).filter(|p| p.is_file()) {
        out.push(profile("wsl", "WSL", p.to_string_lossy(), &[]));
    }
    if let Some(p) = on_path("nu.exe") {
        out.push(profile("nu", "Nushell", p.to_string_lossy(), &[]));
    }
    out
}

/// Shells from $SHELL, /etc/shells and PATH; the user's login shell first.
#[cfg(not(windows))]
pub fn detect_shells() -> Vec<ShellProfile> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(sh) = std::env::var("SHELL") {
        candidates.push(PathBuf::from(sh));
    }
    if let Ok(list) = std::fs::read_to_string("/etc/shells") {
        candidates.extend(list.lines().map(str::trim).filter(|l| l.starts_with('/')).map(PathBuf::from));
    }
    for name in ["zsh", "bash", "fish", "nu", "pwsh", "sh"] {
        if let Some(p) = on_path(name) {
            candidates.push(p);
        }
    }
    let mut out: Vec<ShellProfile> = Vec::new();
    for path in candidates {
        if !path.is_file() {
            continue;
        }
        let id = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        // /bin/bash and /usr/bin/bash are the same entry in the menu.
        if id.is_empty() || out.iter().any(|p| p.id == id) {
            continue;
        }
        let name = match id.as_str() {
            "tmux" | "screen" | "rbash" | "git-shell" => continue,
            "bash" => "Bash",
            "nu" => "Nushell",
            "pwsh" => "PowerShell",
            other => other,
        }
        .to_string();
        // macOS terminals start login shells so ~/.zprofile sets PATH.
        let args: &[&str] = if cfg!(target_os = "macos") && matches!(id.as_str(), "zsh" | "bash" | "fish" | "sh") { &["-l"] } else { &[] };
        out.push(profile(&id, &name, path.to_string_lossy(), args));
    }
    if out.is_empty() {
        out.push(profile("sh", "sh", "/bin/sh", &[]));
    }
    out
}

/// The shell a new terminal starts when nothing else was chosen.
pub fn default_shell() -> String {
    detect_shells().into_iter().next().map(|p| p.program).unwrap_or_else(|| "sh".into())
}

/// What to run: an explicit program + args (a profile), or a command line the
/// user typed in settings ("bash --login", "C:\Program Files\Git\bin\bash.exe").
fn build_command(shell: Option<String>, args: Option<Vec<String>>) -> (String, CommandBuilder) {
    match (shell.filter(|s| !s.trim().is_empty()), args) {
        (Some(program), Some(args)) => {
            let mut c = CommandBuilder::new(&program);
            c.args(args);
            (program, c)
        }
        (Some(line), None) => {
            // A full path may contain spaces.
            if Path::new(&line).is_file() {
                return (line.clone(), CommandBuilder::new(&line));
            }
            let mut parts = line.split_whitespace();
            let mut c = CommandBuilder::new(parts.next().unwrap_or("sh"));
            for arg in parts {
                c.arg(arg);
            }
            (line, c)
        }
        (None, _) => match detect_shells().into_iter().next() {
            Some(p) => {
                let mut c = CommandBuilder::new(&p.program);
                c.args(&p.args);
                (p.program, c)
            }
            None => ("sh".into(), CommandBuilder::new("sh")),
        },
    }
}

/// Kills the shell and releases the pseudo-console. Closing a ConPTY can block
/// until every process holding its pipes lets go (on Windows 10 that may take
/// a while), so the release happens on a thread of its own.
fn close(session: Arc<Session>) {
    let _ = session.killer.lock().unwrap().kill();
    std::thread::spawn(move || drop(session));
}

impl PtyManager {
    #[allow(clippy::too_many_arguments)]
    pub fn spawn<D, X>(&self, cwd: &Path, cols: u16, rows: u16, shell: Option<String>, args: Option<Vec<String>>, on_data: D, on_exit: X) -> AppResult<u32>
    where
        D: Fn(u32, String) + Send + 'static,
        X: Fn(u32, Option<u32>) + Send + 'static,
    {
        let pty = native_pty_system();
        let pair = pty
            .openpty(PtySize { rows: rows.max(2), cols: cols.max(10), pixel_width: 0, pixel_height: 0 })
            .map_err(|e| AppError::msg(format!("Could not open a terminal: {e}")))?;

        let (label, mut cmd) = build_command(shell, args);
        if cwd.is_dir() {
            cmd.cwd(cwd);
        }
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("TERM_PROGRAM", "NoxCode");
        // Apps started from Finder or a desktop launcher often have no locale,
        // and shells then print UTF-8 as '?'.
        if cfg!(unix) && std::env::var_os("LANG").is_none() {
            cmd.env("LANG", "en_US.UTF-8");
        }

        let mut child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| AppError::msg(format!("Could not start '{label}': {e}")))?;
        drop(pair.slave);

        let id = self.next.fetch_add(1, Ordering::SeqCst) + 1;
        let mut reader = pair.master.try_clone_reader().map_err(|e| AppError::msg(e.to_string()))?;
        let writer = pair.master.take_writer().map_err(|e| AppError::msg(e.to_string()))?;
        let killer = child.clone_killer();

        self.sessions.lock().unwrap().insert(
            id,
            Arc::new(Session { writer: Mutex::new(writer), master: Mutex::new(pair.master), killer: Mutex::new(killer) }),
        );

        let this = self.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 16 * 1024];
            let mut stream = Utf8Stream::default();
            // ConPTY opens with a cursor-position query (ESC[6n) and blocks the
            // console - resizes included - until it gets an answer. Answering
            // it here keeps a new terminal from ever waiting on the UI.
            let mut startup_query = cfg!(windows);
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let mut text = stream.push(&buf[..n]);
                        if startup_query && text.contains(CURSOR_QUERY) {
                            startup_query = false;
                            text = text.replacen(CURSOR_QUERY, "", 1);
                            let _ = this.write(id, "\x1b[1;1R");
                        }
                        if !text.is_empty() {
                            on_data(id, text);
                        }
                    }
                }
            }
        });

        // ConPTY keeps the output pipe open after the shell exits, so the exit
        // is detected by waiting on the child, which then drops the session.
        let sessions = self.sessions.clone();
        std::thread::spawn(move || {
            let code = child.wait().ok().map(|s| s.exit_code());
            sessions.lock().unwrap().remove(&id);
            on_exit(id, code);
        });

        Ok(id)
    }

    /// The session, with the map lock released right away.
    fn get(&self, id: u32) -> Option<Arc<Session>> {
        self.sessions.lock().unwrap().get(&id).cloned()
    }

    pub fn write(&self, id: u32, data: &str) -> AppResult<()> {
        let s = self.get(id).ok_or_else(|| AppError::msg("Terminal is closed"))?;
        let mut w = s.writer.lock().unwrap();
        w.write_all(data.as_bytes())?;
        w.flush()?;
        Ok(())
    }

    pub fn resize(&self, id: u32, cols: u16, rows: u16) -> AppResult<()> {
        if let Some(s) = self.get(id) {
            s.master
                .lock()
                .unwrap()
                .resize(PtySize { rows: rows.max(2), cols: cols.max(10), pixel_width: 0, pixel_height: 0 })
                .map_err(|e| AppError::msg(e.to_string()))?;
        }
        Ok(())
    }

    pub fn kill(&self, id: u32) -> AppResult<()> {
        let session = self.sessions.lock().unwrap().remove(&id);
        if let Some(s) = session {
            close(s);
        }
        Ok(())
    }

    pub fn kill_all(&self) {
        let all: Vec<Arc<Session>> = self.sessions.lock().unwrap().drain().map(|(_, s)| s).collect();
        for s in all {
            close(s);
        }
    }

    pub fn count(&self) -> usize {
        self.sessions.lock().unwrap().len()
    }
}
