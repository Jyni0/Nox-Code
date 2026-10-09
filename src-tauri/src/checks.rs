//! Runs a project checker (tsc, cargo check, go vet, ruff…) and captures its
//! output. The command line goes through the platform shell so `npx`, `.cmd`
//! shims and the user's PATH work the same as in a terminal.

use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::error::{AppError, AppResult};

const MAX_OUTPUT: usize = 4 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckOutput {
    /// None when the process was killed (timeout) or ended by a signal.
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
}

fn shell_command(line: &str) -> Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let mut cmd = Command::new("cmd");
        // raw_arg: cmd.exe does its own quote parsing.
        cmd.arg("/D").arg("/S").arg("/C").raw_arg(format!("\"{line}\""));
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd
    }
    #[cfg(not(windows))]
    {
        // A login shell, so tools installed via ~/.zprofile (cargo, go, pyenv) are on PATH.
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
        let mut cmd = Command::new(shell);
        cmd.arg("-lc").arg(line);
        // Own process group, so a timeout can stop everything the shell started.
        std::os::unix::process::CommandExt::process_group(&mut cmd, 0);
        cmd
    }
}

fn drain(mut r: impl Read + Send + 'static) -> std::thread::JoinHandle<String> {
    std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = r.by_ref().take(MAX_OUTPUT as u64).read_to_end(&mut buf);
        // Keep reading so the child never blocks on a full pipe.
        let _ = std::io::copy(&mut r, &mut std::io::sink());
        String::from_utf8_lossy(&buf).into_owned()
    })
}

/// Kills the shell and everything it started (they hold the output pipes open).
fn kill_tree(pid: u32) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = Command::new("taskkill")
            .args(["/T", "/F", "/PID", &pid.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(0x0800_0000)
            .status();
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("kill").args(["-KILL", &format!("-{pid}")]).status();
    }
}

pub fn run(cwd: &Path, line: &str, timeout: Duration) -> AppResult<CheckOutput> {
    let mut child = shell_command(line)
        .current_dir(cwd)
        .env("NO_COLOR", "1")
        .env("CARGO_TERM_COLOR", "never")
        .env("FORCE_COLOR", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| AppError::msg(format!("could not run `{line}`: {e}")))?;
    let out = drain(child.stdout.take().expect("piped"));
    let err = drain(child.stderr.take().expect("piped"));
    let start = Instant::now();
    let mut timed_out = false;
    let status = loop {
        if let Some(s) = child.try_wait()? {
            break Some(s);
        }
        if start.elapsed() > timeout {
            kill_tree(child.id());
            let _ = child.kill();
            let _ = child.wait();
            timed_out = true;
            break None;
        }
        std::thread::sleep(Duration::from_millis(40));
    };
    Ok(CheckOutput {
        code: status.and_then(|s| s.code()),
        stdout: out.join().unwrap_or_default(),
        stderr: err.join().unwrap_or_default(),
        timed_out,
    })
}
