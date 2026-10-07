//! Watches the open project and reports changed paths in small batches.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};

use crate::error::{AppError, AppResult};

const BATCH: Duration = Duration::from_millis(150);

#[derive(Default)]
pub struct ProjectWatcher {
    current: Mutex<Option<RecommendedWatcher>>,
}

/// Paths inside `.git` only matter as "git state changed"; build outputs and
/// dependency folders would flood the editor with events.
pub fn classify(root: &Path, path: &Path) -> Option<String> {
    let rel = path.strip_prefix(root).ok()?;
    let mut comps = rel.components().map(|c| c.as_os_str().to_string_lossy().into_owned());
    let first = comps.next()?;
    if first == ".git" {
        let second = comps.next().unwrap_or_default();
        return matches!(second.as_str(), "index" | "HEAD" | "refs").then(|| ".git".to_string());
    }
    if first == "node_modules" || first == "target" {
        return None;
    }
    Some(path.to_string_lossy().into_owned())
}

impl ProjectWatcher {
    pub fn watch<F>(&self, root: PathBuf, on_change: F) -> AppResult<()>
    where
        F: Fn(Vec<String>) + Send + 'static,
    {
        let (tx, rx) = mpsc::channel::<notify::Result<notify::Event>>();
        let mut watcher = notify::recommended_watcher(tx).map_err(|e| AppError::msg(e.to_string()))?;
        watcher
            .watch(&root, RecursiveMode::Recursive)
            .map_err(|e| AppError::msg(format!("Cannot watch folder: {e}")))?;

        std::thread::spawn(move || {
            // Ends when the watcher (and with it the sender) is dropped.
            while let Ok(first) = rx.recv() {
                let mut batch = BTreeSet::new();
                let mut add = |ev: notify::Result<notify::Event>| {
                    if let Ok(ev) = ev {
                        for p in ev.paths {
                            if let Some(s) = classify(&root, &p) {
                                batch.insert(s);
                            }
                        }
                    }
                };
                add(first);
                while let Ok(ev) = rx.recv_timeout(BATCH) {
                    add(ev);
                }
                if !batch.is_empty() {
                    on_change(batch.into_iter().collect());
                }
            }
        });

        *self.current.lock().unwrap() = Some(watcher);
        Ok(())
    }

    pub fn stop(&self) {
        self.current.lock().unwrap().take();
    }
}
