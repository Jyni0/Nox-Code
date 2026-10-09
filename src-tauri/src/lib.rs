pub mod checks;
pub mod commands;
pub mod error;
pub mod fsops;
pub mod git;
pub mod pty;
pub mod search;
pub mod watcher;

#[cfg(test)]
mod tests;

use tauri::Manager;

/// WebView2 handles Ctrl+P (print), Ctrl+F (find), Ctrl+R / F5 (reload),
/// Ctrl+wheel (zoom) and friends before the page sees them. The editor owns
/// every shortcut, so the browser ones are switched off.
#[cfg(windows)]
fn disable_browser_shortcuts(window: &tauri::WebviewWindow) {
    let _ = window.with_webview(|webview| unsafe {
        use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
        use windows_core::Interface;
        let Ok(core) = webview.controller().CoreWebView2() else { return };
        let Ok(settings) = core.Settings() else { return };
        let _ = settings.SetIsZoomControlEnabled(false);
        if let Ok(s3) = settings.cast::<ICoreWebView2Settings3>() {
            let _ = s3.SetAreBrowserAcceleratorKeysEnabled(false);
        }
    });
}

/// WKWebView and WebKitGTK have no browser shortcuts of their own; the page's
/// keydown handler (which calls preventDefault) is enough there.
#[cfg(not(windows))]
fn disable_browser_shortcuts(_window: &tauri::WebviewWindow) {}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(commands::AppState::default())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                disable_browser_shortcuts(&window);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::fs_list_dir,
            commands::fs_read_file,
            commands::fs_read_base64,
            commands::fs_write_file,
            commands::fs_create_file,
            commands::fs_create_dir,
            commands::fs_rename,
            commands::fs_copy,
            commands::fs_delete,
            commands::fs_exists,
            commands::fs_list_files,
            commands::search_project,
            commands::replace_project,
            commands::git_info,
            commands::git_head_content,
            commands::git_stage,
            commands::git_unstage,
            commands::git_discard,
            commands::git_commit,
            commands::git_init,
            commands::pty_spawn,
            commands::pty_write,
            commands::pty_resize,
            commands::pty_kill,
            commands::watch_project,
            commands::unwatch_project,
            commands::startup_path,
            commands::source_checkout,
            commands::default_shell,
            commands::list_shells,
            commands::run_check,
        ])
        .on_window_event(|window, event| {
            // No tray, no background mode: closing the window ends the app and
            // takes every terminal with it.
            if let tauri::WindowEvent::Destroyed = event {
                let state = window.app_handle().state::<commands::AppState>();
                state.pty.kill_all();
                state.watcher.stop();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Nox Code");
}
