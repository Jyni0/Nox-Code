use std::fs;
use std::process::Command;

use crate::git::*;

#[test]
fn parses_branch_header_variants() {
    assert_eq!(parse_branch_line("## main...origin/main [ahead 2, behind 1]"), (Some("main".into()), 2, 1));
    assert_eq!(parse_branch_line("## dev...origin/dev [behind 3]"), (Some("dev".into()), 0, 3));
    assert_eq!(parse_branch_line("## feature/x"), (Some("feature/x".into()), 0, 0));
    assert_eq!(parse_branch_line("## No commits yet on main"), (Some("main".into()), 0, 0));
    assert_eq!(parse_branch_line("## HEAD (no branch)"), (Some("HEAD".into()), 0, 0));
}

#[test]
fn parses_status_letters_staging_and_renames() {
    let out = "## main\n M src/a.ts\nM  src/b.ts\nMM src/c.ts\nA  new.rs\n D gone.txt\nR  old.md -> docs/new.md\n?? scratch.txt\nUU merge.txt\n";
    let info = parse_status(out);
    assert!(info.is_repo);
    assert_eq!(info.branch.as_deref(), Some("main"));
    let find = |p: &str| info.files.iter().find(|f| f.path == p).cloned().unwrap();
    assert_eq!((find("src/a.ts").status.as_str(), find("src/a.ts").staged), ("M", false));
    let b = find("src/b.ts");
    assert_eq!((b.status.as_str(), b.staged, b.unstaged), ("M", true, false));
    assert!(find("src/c.ts").staged && find("src/c.ts").unstaged);
    assert_eq!(find("new.rs").status, "A");
    assert_eq!(find("gone.txt").status, "D");
    assert_eq!(find("docs/new.md").status, "R");
    assert_eq!(find("scratch.txt").status, "?");
    assert_eq!(find("merge.txt").status, "U");
}

#[test]
fn quoted_paths_are_unquoted() {
    let info = parse_status("?? \"dir/my file.txt\"\n");
    assert_eq!(info.files[0].path, "dir/my file.txt");
}

fn have_git() -> bool {
    Command::new("git").arg("--version").output().map(|o| o.status.success()).unwrap_or(false)
}

#[test]
fn real_repo_status_stage_commit_and_head_content() {
    if !have_git() {
        eprintln!("git not installed — skipping");
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    init(root).unwrap();
    for (k, v) in [("user.email", "t@t.dev"), ("user.name", "Nox Test"), ("commit.gpgsign", "false"), ("core.autocrlf", "false")] {
        git(root).args(["config", k, v]).output().unwrap();
    }
    fs::write(root.join("a.txt"), "one\n").unwrap();
    let st = info(root);
    assert!(st.is_repo);
    assert_eq!(st.files[0].status, "?");

    stage(root, &["a.txt".into()]).unwrap();
    assert!(info(root).files[0].staged);
    unstage(root, &["a.txt".into()]).unwrap();
    assert_eq!(info(root).files[0].status, "?");

    stage(root, &["a.txt".into()]).unwrap();
    commit(root, "first").unwrap();
    assert!(info(root).files.is_empty());
    assert!(commit(root, "  ").is_err());

    fs::write(root.join("a.txt"), "two\n").unwrap();
    assert_eq!(info(root).files[0].status, "M");
    assert_eq!(head_content(root, "a.txt").as_deref(), Some("one\n"));
    assert_eq!(head_content(root, "missing.txt"), None);

    discard(root, &["a.txt".into()]).unwrap();
    assert_eq!(fs::read_to_string(root.join("a.txt")).unwrap(), "one\n");
}

#[test]
fn non_repo_reports_not_a_repo() {
    let dir = tempfile::tempdir().unwrap();
    assert!(!info(dir.path()).is_repo);
}
