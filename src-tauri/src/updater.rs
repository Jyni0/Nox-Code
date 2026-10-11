//! Updates from GitHub releases: download the release's installer for this
//! platform (with progress), then run it. The release lookup and the choice
//! of asset happen in the frontend; this only moves bytes and starts files.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

/// Only installers from GitHub's own hosts are downloaded.
fn allowed(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else { return false };
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    host == "github.com" || host.ends_with(".githubusercontent.com")
}

/// A file name safe to create in the download folder.
fn clean_name(name: &str) -> String {
    let s: String = name.chars().map(|c| if c.is_ascii_alphanumeric() || "._-".contains(c) { c } else { '_' }).collect();
    if s.trim_matches(['.', '_']).is_empty() { "nox-code-update".into() } else { s }
}

/// Downloads `url` into the temp folder; `progress(received, total)` is called
/// a few times a second. Returns the file's path.
pub fn download(url: &str, name: &str, mut progress: impl FnMut(u64, Option<u64>)) -> Result<PathBuf, String> {
    if !allowed(url) {
        return Err("Updates are only downloaded from GitHub".into());
    }
    let dir = std::env::temp_dir().join("nox-code-update");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(clean_name(name));
    let part = path.with_extension("part");

    let agent = ureq::AgentBuilder::new().timeout_connect(Duration::from_secs(15)).timeout_read(Duration::from_secs(60)).build();
    let res = agent
        .get(url)
        .set("User-Agent", "Nox-Code-Updater")
        .set("Accept", "application/octet-stream")
        .call()
        .map_err(|e| format!("Download failed: {e}"))?;
    let total = res.header("Content-Length").and_then(|v| v.parse::<u64>().ok());
    let mut reader = res.into_reader();
    let mut file = std::fs::File::create(&part).map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; 64 * 1024];
    let mut received = 0u64;
    let mut last = Instant::now();
    progress(0, total);
    loop {
        let n = reader.read(&mut buf).map_err(|e| format!("Download interrupted: {e}"))?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        received += n as u64;
        if last.elapsed() >= Duration::from_millis(150) {
            progress(received, total);
            last = Instant::now();
        }
    }
    file.flush().map_err(|e| e.to_string())?;
    drop(file);
    if total.is_some_and(|t| t != received) {
        let _ = std::fs::remove_file(&part);
        return Err("Download incomplete — try again".into());
    }
    progress(received, total);
    let _ = std::fs::remove_file(&path);
    std::fs::rename(&part, &path).map_err(|e| e.to_string())?;
    Ok(path)
}

/// Starts the downloaded installer. Returns true when the app should quit so
/// the installer can replace it (Windows); elsewhere the file is just opened.
pub fn launch(path: &Path) -> Result<bool, String> {
    if !path.starts_with(std::env::temp_dir().join("nox-code-update")) || !path.is_file() {
        return Err("Not a downloaded update".into());
    }
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        let mut cmd = match ext.as_str() {
            // NSIS (Tauri's installer), as Tauri's own updater runs it: /P passive (a
            // progress bar, no questions), /UPDATE keeps settings and data, /R
            // starts the new version when done.
            "exe" => {
                let mut c = std::process::Command::new(path);
                c.args(["/P", "/UPDATE", "/R"]);
                c
            }
            "msi" => {
                let mut c = std::process::Command::new("msiexec");
                c.arg("/i").arg(path).arg("/passive");
                c
            }
            _ => return Err("Unknown installer type".into()),
        };
        cmd.creation_flags(DETACHED_PROCESS).spawn().map_err(|e| format!("Could not start the installer: {e}"))?;
        Ok(true)
    }
    #[cfg(target_os = "macos")]
    {
        // A .dmg opens in Finder: drag Nox Code into Applications.
        let _ = ext;
        std::process::Command::new("open").arg(path).spawn().map_err(|e| e.to_string())?;
        Ok(false)
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if ext == "appimage" {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755));
        }
        // .deb / .rpm open in the software installer; an AppImage's folder opens.
        let target = if ext == "appimage" { path.parent().unwrap_or(path) } else { path };
        std::process::Command::new("xdg-open").arg(target).spawn().map_err(|e| e.to_string())?;
        Ok(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_github_urls_and_safe_names() {
        assert!(allowed("https://github.com/Jyni0/Nox-Code/releases/download/Release-1.9.2/Nox.Code_1.9.2_x64-setup.exe"));
        assert!(allowed("https://objects.githubusercontent.com/x"));
        assert!(!allowed("http://github.com/x"));
        assert!(!allowed("https://github.com.evil.example/x"));
        assert!(!allowed("https://evil.example/github.com"));
        assert_eq!(clean_name("Nox.Code_1.9.2_x64-setup.exe"), "Nox.Code_1.9.2_x64-setup.exe");
        assert_eq!(clean_name("../../x y.exe"), ".._.._x_y.exe");
        assert!(launch(Path::new("C:/Windows/notepad.exe")).is_err());
    }
}
