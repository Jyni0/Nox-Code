use std::time::Duration;

use crate::checks;

#[test]
fn captures_output_and_exit_code() {
    let dir = std::env::temp_dir();
    let out = checks::run(&dir, "echo hello && echo oops 1>&2 && exit 3", Duration::from_secs(20)).unwrap();
    assert!(out.stdout.contains("hello"), "{}", out.stdout);
    assert!(out.stderr.contains("oops"), "{}", out.stderr);
    assert_eq!(out.code, Some(3));
    assert!(!out.timed_out);
}

#[test]
fn missing_program_is_reported_as_not_found() {
    let out = checks::run(&std::env::temp_dir(), "nox_no_such_tool_xyz --version", Duration::from_secs(20)).unwrap();
    // POSIX shells exit with 127; cmd.exe with 1 or 9009 and says so on stderr.
    assert!(out.code == Some(127) || out.stderr.contains("not recognized"), "{:?} {}", out.code, out.stderr);
}

#[test]
fn kills_on_timeout() {
    let line = if cfg!(windows) { "ping -n 20 127.0.0.1 > nul" } else { "sleep 20" };
    let start = std::time::Instant::now();
    let out = checks::run(&std::env::temp_dir(), line, Duration::from_millis(500)).unwrap();
    assert!(out.timed_out);
    assert!(start.elapsed() < Duration::from_secs(8), "took {:?}", start.elapsed());
}
