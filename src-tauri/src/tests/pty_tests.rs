use std::sync::mpsc;
use std::time::{Duration, Instant};

use crate::pty::*;

#[test]
fn utf8_stream_joins_split_characters() {
    let mut s = Utf8Stream::default();
    let bytes = "привет".as_bytes();
    let a = s.push(&bytes[..3]);
    let b = s.push(&bytes[3..]);
    assert_eq!(format!("{a}{b}"), "привет");
}

#[test]
fn utf8_stream_replaces_invalid_bytes() {
    let mut s = Utf8Stream::default();
    assert_eq!(s.push(&[b'a', 0xFF, b'b']), "a\u{FFFD}b");
}

#[test]
fn default_shell_is_never_empty() {
    assert!(!default_shell().is_empty());
}

#[test]
fn detects_at_least_one_shell_with_unique_ids() {
    let shells = detect_shells();
    assert!(!shells.is_empty());
    let mut ids: Vec<_> = shells.iter().map(|s| s.id.clone()).collect();
    ids.sort();
    ids.dedup();
    assert_eq!(ids.len(), shells.len());
    if cfg!(windows) {
        assert!(shells.iter().any(|s| s.id == "cmd"));
    }
}

#[test]
fn many_terminals_run_side_by_side() {
    // Regression: nobody answers the cursor query here (no xterm.js), which
    // used to block every resize - and froze the app on a second terminal.
    let mgr = PtyManager::default();
    let shell = if cfg!(windows) { "cmd.exe" } else { "/bin/sh" };
    let ids: Vec<u32> = (0..3)
        .map(|_| mgr.spawn(&std::env::temp_dir(), 80, 24, Some(shell.into()), None, |_, _| {}, |_, _| {}).unwrap())
        .collect();
    assert_eq!(mgr.count(), 3);
    let started = Instant::now();
    for id in &ids {
        mgr.resize(*id, 100, 30).unwrap();
    }
    assert!(started.elapsed() < Duration::from_secs(5));
    mgr.kill_all();
    assert_eq!(mgr.count(), 0);
}

#[test]
fn explicit_program_and_args_are_used() {
    let mgr = PtyManager::default();
    let (tx, rx) = mpsc::channel::<String>();
    let (program, args) = if cfg!(windows) {
        ("cmd.exe", vec!["/c".to_string(), "echo".into(), "args-ok".into()])
    } else {
        ("/bin/echo", vec!["args-ok".to_string()])
    };
    let id = mgr
        .spawn(
            &std::env::temp_dir(),
            80,
            24,
            Some(program.into()),
            Some(args),
            move |_, d| {
                let _ = tx.send(d);
            },
            |_, _| {},
        )
        .unwrap();
    let mut seen = String::new();
    let deadline = Instant::now() + Duration::from_secs(15);
    while Instant::now() < deadline && !seen.contains("args-ok") {
        if let Ok(d) = rx.recv_timeout(Duration::from_millis(200)) {
            seen.push_str(&d);
        }
    }
    assert!(seen.contains("args-ok"), "output was: {seen:?}");
    let _ = mgr.kill(id);
}

#[test]
fn spawns_a_command_streams_output_and_reports_exit() {
    let mgr = PtyManager::default();
    let (tx, rx) = mpsc::channel::<String>();
    let (etx, erx) = mpsc::channel::<u32>();
    let shell = if cfg!(windows) { "cmd.exe /c echo nox-ok" } else { "/bin/echo nox-ok" };
    let id = mgr
        .spawn(
            &std::env::temp_dir(),
            80,
            24,
            Some(shell.to_string()),
            None,
            move |_, d| {
                let _ = tx.send(d);
            },
            move |id, _| {
                let _ = etx.send(id);
            },
        )
        .unwrap();
    assert!(id > 0);
    let mut seen = String::new();
    let deadline = Instant::now() + Duration::from_secs(15);
    while Instant::now() < deadline && !seen.contains("nox-ok") {
        if let Ok(d) = rx.recv_timeout(Duration::from_millis(200)) {
            seen.push_str(&d);
        }
    }
    assert!(seen.contains("nox-ok"), "output was: {seen:?}");
    // ConPTY's startup cursor query is answered by the backend, never forwarded.
    assert!(!seen.contains("\x1b[6n"), "output was: {seen:?}");
    assert_eq!(erx.recv_timeout(Duration::from_secs(15)).unwrap(), id);
    // The exited session is dropped; writing to it is an error.
    assert!(mgr.write(id, "x").is_err());
    assert_eq!(mgr.count(), 0);
}

#[test]
fn kill_closes_a_running_shell() {
    let mgr = PtyManager::default();
    let (etx, erx) = mpsc::channel::<u32>();
    let shell = if cfg!(windows) { "cmd.exe" } else { "/bin/sh" };
    let id = mgr
        .spawn(&std::env::temp_dir(), 80, 24, Some(shell.into()), None, |_, _| {}, move |id, _| {
            let _ = etx.send(id);
        })
        .unwrap();
    assert_eq!(mgr.count(), 1);
    mgr.resize(id, 120, 40).unwrap();
    mgr.write(id, "echo hi\r").unwrap();
    mgr.kill(id).unwrap();
    assert_eq!(mgr.count(), 0);
    assert_eq!(erx.recv_timeout(Duration::from_secs(15)).unwrap(), id);
}
