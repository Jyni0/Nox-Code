//! Windows of Nox Code are separate processes. The first one holds a lock
//! file for its lifetime: it owns the saved session (last folder and tabs),
//! while every other window starts empty, as a new window should.
//!
//! Also the `nox` terminal command: a tiny launcher put on the PATH, so
//! `nox .` or `nox C:\code\app` opens a new window on that folder.

use std::fs::File;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

static PRIMARY: OnceLock<(bool, Option<File>)> = OnceLock::new();

fn lock_path() -> PathBuf {
    let user = std::env::var("USERNAME").or_else(|_| std::env::var("USER")).unwrap_or_default();
    std::env::temp_dir().join(format!("nox-code-{}.lock", user.replace(|c: char| !c.is_ascii_alphanumeric(), "_")))
}

/// True for the first running window (decided once, kept until it exits).
pub fn is_primary() -> bool {
    PRIMARY
        .get_or_init(|| match File::options().create(true).truncate(false).write(true).open(lock_path()) {
            Ok(f) => match f.try_lock() {
                Ok(()) => (true, Some(f)),
                Err(_) => (false, None),
            },
            // No lock possible (read-only temp?): behave like a single window.
            Err(_) => (true, None),
        })
        .0
}

/// Opens another window: this program again, on `path` when given.
pub fn new_window(path: Option<&str>) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let mut cmd = std::process::Command::new(exe);
    if let Some(p) = path.filter(|p| !p.is_empty()) {
        cmd.arg(p);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        cmd.creation_flags(DETACHED_PROCESS);
    }
    cmd.spawn().map(|_| ()).map_err(|e| format!("Could not open a new window: {e}"))
}

/* ---------------- the `nox` command ---------------- */

/// A build run from the source tree (`tauri dev`): its path is temporary.
pub fn is_dev_build() -> bool {
    std::env::current_exe()
        .map(|p| p.components().any(|c| c.as_os_str() == "target") && p.components().any(|c| c.as_os_str() == "src-tauri"))
        .unwrap_or(false)
}

#[cfg(windows)]
fn bin_dir() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(|d| PathBuf::from(d).join("NoxCode").join("bin"))
}

#[cfg(not(windows))]
fn bin_dir() -> Option<PathBuf> {
    let home = PathBuf::from(std::env::var_os("HOME")?);
    #[cfg(target_os = "macos")]
    return Some(home.join("Library/Application Support/dev.noxcode.editor/bin"));
    #[cfg(not(target_os = "macos"))]
    return Some(home.join(".local/share/nox-code/bin"));
}

/// Where the command is linked on macOS / Linux (a folder already on the PATH).
#[cfg(not(windows))]
fn link_path() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    return Some(PathBuf::from("/usr/local/bin/nox"));
    #[cfg(not(target_os = "macos"))]
    return Some(PathBuf::from(std::env::var_os("HOME")?).join(".local/bin/nox"));
}

fn script(exe: &Path) -> String {
    let exe = exe.to_string_lossy();
    #[cfg(windows)]
    return format!("@echo off\r\nrem Nox Code: nox [folder or file]\r\nstart \"\" \"{exe}\" %*\r\n");
    // nohup + &: the window outlives the terminal it was started from; the
    // working folder is kept, so `nox .` means this folder.
    #[cfg(not(windows))]
    return format!("#!/bin/sh\n# Nox Code: nox [folder or file]\nnohup \"{}\" \"$@\" >/dev/null 2>&1 &\n", exe.replace('"', "\\\""));
}

#[cfg(windows)]
fn script_path(dir: &Path) -> PathBuf {
    dir.join("nox.cmd")
}
#[cfg(not(windows))]
fn script_path(dir: &Path) -> PathBuf {
    dir.join("nox")
}

/// PowerShell, without a console window flashing up.
#[cfg(windows)]
fn powershell(script: &str) -> Result<String, String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let out = std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// The user PATH, read raw so entries like %USERPROFILE%\x stay as they are.
#[cfg(windows)]
const READ_PATH: &str = "(Get-Item 'HKCU:\\Environment').GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)";

#[cfg(windows)]
fn set_user_path(change: &str, add: bool) -> Result<(), String> {
    // Written as REG_EXPAND_SZ; the empty SetEnvironmentVariable afterwards
    // tells Explorer (and the terminals it starts) that the PATH changed.
    powershell(&format!(
        "$d = '{change}'; $add = ${add}; $p = {READ_PATH}; $parts = @($p -split ';' | Where-Object {{ $_ -and $_.TrimEnd('\\') -ne $d.TrimEnd('\\') }}); \
         if ($add) {{ $parts += $d }}; \
         Set-ItemProperty -Path 'HKCU:\\Environment' -Name Path -Value ($parts -join ';') -Type ExpandString; \
         [Environment]::SetEnvironmentVariable('NOX_CODE_PATH_REFRESH', $null, 'User')",
        change = change.replace('\'', "''"),
        add = if add { "true" } else { "false" },
    ))
    .map(|_| ())
}

/// Is the `nox` command installed (and pointing at this program)?
pub fn cli_installed() -> bool {
    let Some(dir) = bin_dir() else { return false };
    let Ok(text) = std::fs::read_to_string(script_path(&dir)) else { return false };
    let current = std::env::current_exe().map(|e| text.contains(&*e.to_string_lossy())).unwrap_or(false);
    #[cfg(windows)]
    let reachable = powershell(READ_PATH).map(|p| p.split(';').any(|e| Path::new(e.trim_end_matches('\\')) == dir)).unwrap_or(false);
    #[cfg(not(windows))]
    let reachable = link_path().is_some_and(|l| std::fs::read_link(&l).is_ok_and(|t| t == script_path(&dir)));
    current && reachable
}

/// Installs `nox`; returns where it was put.
pub fn install_cli() -> Result<String, String> {
    let dir = bin_dir().ok_or("No home folder")?;
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file = script_path(&dir);
    std::fs::write(&file, script(&exe)).map_err(|e| e.to_string())?;
    #[cfg(windows)]
    {
        set_user_path(&dir.to_string_lossy(), true)?;
        add_to_own_path(&dir);
        Ok(file.to_string_lossy().into_owned())
    }
    #[cfg(not(windows))]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
        let link = link_path().ok_or("No home folder")?;
        let _ = std::fs::remove_file(&link);
        if let Some(parent) = link.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if std::os::unix::fs::symlink(&file, &link).is_err() {
            // /usr/local/bin belongs to root on many Macs: ask for the password once.
            #[cfg(target_os = "macos")]
            {
                let sh = format!("mkdir -p /usr/local/bin && ln -sf '{}' '{}'", file.to_string_lossy().replace('\'', "'\\''"), link.to_string_lossy());
                let status = std::process::Command::new("osascript")
                    .args(["-e", &format!("do shell script \"{}\" with administrator privileges", sh.replace('\\', "\\\\").replace('"', "\\\""))])
                    .status()
                    .map_err(|e| e.to_string())?;
                if !status.success() {
                    return Err("Not installed: administrator permission was not given".into());
                }
            }
            #[cfg(not(target_os = "macos"))]
            return Err(format!("Could not create {}", link.display()));
        }
        Ok(link.to_string_lossy().into_owned())
    }
}

pub fn uninstall_cli() -> Result<(), String> {
    let dir = bin_dir().ok_or("No home folder")?;
    let _ = std::fs::remove_file(script_path(&dir));
    #[cfg(windows)]
    {
        set_user_path(&dir.to_string_lossy(), false)
    }
    #[cfg(not(windows))]
    {
        if let Some(link) = link_path() {
            if std::fs::read_link(&link).is_ok_and(|t| t == script_path(&dir)) && std::fs::remove_file(&link).is_err() {
                #[cfg(target_os = "macos")]
                {
                    let _ = std::process::Command::new("osascript")
                        .args(["-e", &format!("do shell script \"rm -f '{}'\" with administrator privileges", link.to_string_lossy())])
                        .status();
                }
            }
        }
        Ok(())
    }
}

/// Terminals opened inside this window inherit its environment: put `nox`
/// on it too, so it works there without restarting Nox.
#[cfg(windows)]
fn add_to_own_path(dir: &Path) {
    let current = std::env::var_os("PATH").unwrap_or_default();
    if std::env::split_paths(&current).any(|p| p == dir) {
        return;
    }
    let mut parts: Vec<PathBuf> = std::env::split_paths(&current).collect();
    parts.push(dir.to_path_buf());
    if let Ok(joined) = std::env::join_paths(parts) {
        std::env::set_var("PATH", joined);
    }
}

/// On Windows the command is set up by itself the first time an installed
/// Nox Code starts (no admin needed); removing it afterwards sticks.
pub fn auto_install_once() {
    #[cfg(windows)]
    {
        if is_dev_build() {
            return;
        }
        let Some(dir) = bin_dir() else { return };
        let marker = dir.join(".offered");
        if marker.exists() {
            // Installed before: keep its script pointing at this (maybe moved) program.
            if script_path(&dir).exists() && !cli_installed() {
                let _ = install_cli();
            } else if script_path(&dir).exists() {
                add_to_own_path(&dir);
            }
            return;
        }
        if install_cli().is_ok() {
            let _ = std::fs::write(marker, "");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_process_is_primary_and_scripts_quote_paths() {
        assert!(is_primary());
        assert!(is_primary(), "stays primary");
        // Another window (a second handle, as another process would open) can't take the lock.
        let other = File::options().write(true).open(lock_path()).unwrap();
        assert!(other.try_lock().is_err(), "a second window is not primary");
        let s = script(Path::new("/Applications/Nox Code.app/Contents/MacOS/Nox Code"));
        assert!(s.contains("Nox Code"));
        #[cfg(windows)]
        assert!(s.contains("start \"\" \"") && s.contains("%*"));
        #[cfg(not(windows))]
        assert!(s.contains("\"$@\"") && s.starts_with("#!/bin/sh"));
    }
}
