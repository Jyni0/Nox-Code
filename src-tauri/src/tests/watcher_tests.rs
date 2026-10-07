use std::path::Path;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use crate::watcher::*;

#[test]
fn classify_filters_noise() {
    let root = Path::new("/p");
    assert_eq!(classify(root, Path::new("/p/src/a.ts")).as_deref(), Some(Path::new("/p/src/a.ts").to_string_lossy().as_ref()));
    assert_eq!(classify(root, Path::new("/p/.git/index")).as_deref(), Some(".git"));
    assert_eq!(classify(root, Path::new("/p/.git/objects/ab/cd")), None);
    assert_eq!(classify(root, Path::new("/p/node_modules/x/y.js")), None);
    assert_eq!(classify(root, Path::new("/p/target/debug/x")), None);
    assert_eq!(classify(root, Path::new("/elsewhere/x")), None);
}

#[test]
fn reports_created_files() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().to_path_buf();
    let w = ProjectWatcher::default();
    let (tx, rx) = mpsc::channel::<Vec<String>>();
    w.watch(root.clone(), move |paths| {
        let _ = tx.send(paths);
    })
    .unwrap();
    std::thread::sleep(Duration::from_millis(200));
    std::fs::write(root.join("hello.txt"), "x").unwrap();
    let mut got: Vec<String> = Vec::new();
    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline && !got.iter().any(|p| p.ends_with("hello.txt")) {
        if let Ok(batch) = rx.recv_timeout(Duration::from_millis(300)) {
            got.extend(batch);
        }
    }
    assert!(got.iter().any(|p| p.ends_with("hello.txt")), "{got:?}");
    w.stop();
}
