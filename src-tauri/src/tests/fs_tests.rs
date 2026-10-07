use std::fs;

use crate::fsops::*;

#[test]
fn list_dir_puts_folders_first_case_insensitively() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("b.txt"), "b").unwrap();
    fs::write(dir.path().join("A.txt"), "a").unwrap();
    fs::create_dir(dir.path().join("zeta")).unwrap();
    fs::create_dir(dir.path().join("Alpha")).unwrap();
    let names: Vec<(String, bool)> = list_dir(dir.path()).unwrap().into_iter().map(|e| (e.name, e.is_dir)).collect();
    assert_eq!(
        names,
        vec![
            ("Alpha".to_string(), true),
            ("zeta".to_string(), true),
            ("A.txt".to_string(), false),
            ("b.txt".to_string(), false)
        ]
    );
}

#[test]
fn read_file_detects_crlf_bom_and_binary() {
    let dir = tempfile::tempdir().unwrap();
    let crlf = dir.path().join("win.txt");
    fs::write(&crlf, b"\xEF\xBB\xBFone\r\ntwo\r\n").unwrap();
    let c = read_file(&crlf).unwrap();
    assert!(c.bom);
    assert_eq!(c.line_ending, "CRLF");
    assert_eq!(c.content, "one\r\ntwo\r\n");
    assert!(!c.binary);

    let bin = dir.path().join("x.bin");
    fs::write(&bin, [1u8, 0, 2, 3]).unwrap();
    let b = read_file(&bin).unwrap();
    assert!(b.binary);
    assert!(b.content.is_empty());
}

#[test]
fn read_file_refuses_folders() {
    let dir = tempfile::tempdir().unwrap();
    assert!(read_file(dir.path()).is_err());
}

#[test]
fn write_file_restores_line_endings_and_bom() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("out.txt");
    write_file(&p, "a\nb\n", "CRLF", true).unwrap();
    assert_eq!(fs::read(&p).unwrap(), b"\xEF\xBB\xBFa\r\nb\r\n");
    write_file(&p, "a\r\nb", "LF", false).unwrap();
    assert_eq!(fs::read_to_string(&p).unwrap(), "a\nb");
}

#[test]
fn apply_line_ending_never_doubles_cr() {
    assert_eq!(apply_line_ending("x\r\ny\nz", "CRLF"), "x\r\ny\r\nz");
}

#[test]
fn create_rename_copy_delete_round_trip() {
    let dir = tempfile::tempdir().unwrap();
    let f = dir.path().join("nested/deep/new.ts");
    create_file(&f).unwrap();
    assert!(f.is_file());
    assert!(create_file(&f).is_err(), "creating twice must fail");

    let d = dir.path().join("folder");
    create_dir(&d).unwrap();
    assert!(create_dir(&d).is_err());

    let renamed = dir.path().join("nested/deep/renamed.ts");
    rename(&f, &renamed).unwrap();
    assert!(!f.exists() && renamed.exists());

    fs::write(d.join("inner.txt"), "hi").unwrap();
    let copy = dir.path().join("folder copy");
    copy_path(&d, &copy).unwrap();
    assert_eq!(fs::read_to_string(copy.join("inner.txt")).unwrap(), "hi");
    assert!(copy_path(&d, &copy).is_err());

    delete(&copy, false).unwrap();
    assert!(!copy.exists());
    delete(&copy, false).unwrap(); // already gone: no error
}

#[test]
fn rename_refuses_to_overwrite() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("a"), "").unwrap();
    fs::write(dir.path().join("b"), "").unwrap();
    assert!(rename(&dir.path().join("a"), &dir.path().join("b")).is_err());
}

#[test]
fn list_files_honours_gitignore_and_skips_dot_git() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    fs::create_dir_all(root.join("src")).unwrap();
    fs::create_dir_all(root.join("dist")).unwrap();
    fs::create_dir_all(root.join(".git")).unwrap();
    fs::write(root.join(".gitignore"), "dist/\n*.log\n").unwrap();
    fs::write(root.join("src/main.rs"), "").unwrap();
    fs::write(root.join("dist/bundle.js"), "").unwrap();
    fs::write(root.join("debug.log"), "").unwrap();
    fs::write(root.join(".git/HEAD"), "").unwrap();
    fs::write(root.join(".env"), "").unwrap();
    let files = list_files(root, 1000).unwrap();
    assert_eq!(files, vec![".env", ".gitignore", "src/main.rs"]);
}

#[test]
fn list_files_respects_the_cap() {
    let dir = tempfile::tempdir().unwrap();
    for i in 0..20 {
        fs::write(dir.path().join(format!("f{i}.txt")), "").unwrap();
    }
    assert_eq!(list_files(dir.path(), 5).unwrap().len(), 5);
}

#[test]
fn read_base64_encodes_bytes() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("x.png");
    fs::write(&p, [0u8, 1, 2, 255]).unwrap();
    assert_eq!(read_base64(&p).unwrap(), "AAEC/w==");
}
