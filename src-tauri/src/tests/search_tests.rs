use std::fs;

use crate::search::*;

fn opts(q: &str) -> SearchOptions {
    SearchOptions { query: q.into(), ..Default::default() }
}

fn project() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    fs::create_dir_all(r.join("src")).unwrap();
    fs::create_dir_all(r.join("node_modules/lib")).unwrap();
    fs::write(r.join(".gitignore"), "node_modules\n").unwrap();
    fs::write(r.join("src/app.ts"), "const Foo = 1;\nfoo(Foo);\nfoobar();\n").unwrap();
    fs::write(r.join("src/style.css"), ".foo { color: red }\n").unwrap();
    fs::write(r.join("node_modules/lib/index.js"), "foo\n").unwrap();
    fs::write(r.join("blob.bin"), [b'f', b'o', b'o', 0]).unwrap();
    dir
}

#[test]
fn plain_search_is_case_insensitive_and_skips_ignored_and_binary() {
    let p = project();
    let res = search(p.path(), &opts("foo")).unwrap();
    let rels: Vec<&str> = res.files.iter().map(|f| f.rel.as_str()).collect();
    assert_eq!(rels, vec!["src/app.ts", "src/style.css"]);
    assert_eq!(res.total_matches, 5);
    assert!(!res.truncated);
}

#[test]
fn case_sensitive_and_whole_word() {
    let p = project();
    let mut o = opts("Foo");
    o.case_sensitive = true;
    assert_eq!(search(p.path(), &o).unwrap().total_matches, 2);
    let mut w = opts("foo");
    w.whole_word = true;
    // "foobar" no longer matches.
    assert_eq!(search(p.path(), &w).unwrap().total_matches, 4);
}

#[test]
fn regex_and_include_exclude_globs() {
    let p = project();
    let mut o = opts(r"foo\w+");
    o.regex = true;
    let res = search(p.path(), &o).unwrap();
    assert_eq!(res.total_matches, 1);
    assert_eq!(res.files[0].matches[0].line, 3);

    let mut inc = opts("foo");
    inc.include = "*.css".into();
    assert_eq!(search(p.path(), &inc).unwrap().files.len(), 1);

    let mut exc = opts("foo");
    exc.exclude = "*.css, *.md".into();
    let res = search(p.path(), &exc).unwrap();
    assert_eq!(res.files.len(), 1);
    assert_eq!(res.files[0].rel, "src/app.ts");
}

#[test]
fn columns_are_utf16_offsets() {
    let re = build_regex(&opts("x")).unwrap();
    // The emoji is two UTF-16 units, "é" one, then a space.
    let m = find_in_text(&re, "😀é x", 10);
    assert_eq!(m[0].col, 4);
    assert_eq!(m[0].len, 1);
    assert_eq!(m[0].line, 1);
}

#[test]
fn crlf_lines_do_not_leak_carriage_returns() {
    let re = build_regex(&SearchOptions { query: "b$".into(), regex: true, ..Default::default() }).unwrap();
    let m = find_in_text(&re, "a\r\nb\r\n", 10);
    assert_eq!(m.len(), 1);
    assert_eq!(m[0].preview, "b");
}

#[test]
fn max_results_truncates() {
    let p = project();
    let mut o = opts("foo");
    o.max_results = 2;
    let res = search(p.path(), &o).unwrap();
    assert_eq!(res.total_matches, 2);
    assert!(res.truncated);
}

#[test]
fn invalid_regex_and_empty_query_are_errors() {
    let p = project();
    let mut o = opts("(");
    o.regex = true;
    assert!(search(p.path(), &o).is_err());
    assert!(search(p.path(), &opts("")).is_err());
}

#[test]
fn replace_plain_is_literal_and_regex_expands_groups() {
    let p = project();
    let mut o = opts("foo(");
    o.case_sensitive = true;
    let r = replace_all(p.path(), &o, "bar$1(", None).unwrap();
    assert_eq!(r, ReplaceResult { files_changed: 1, replacements: 1 });
    let text = fs::read_to_string(p.path().join("src/app.ts")).unwrap();
    assert!(text.contains("bar$1(Foo)"), "{text}");

    let mut re = opts(r"const (\w+)");
    re.regex = true;
    replace_all(p.path(), &re, "let $1", None).unwrap();
    let text = fs::read_to_string(p.path().join("src/app.ts")).unwrap();
    assert!(text.starts_with("let Foo = 1;"));
}

#[test]
fn replace_only_in_selected_files() {
    let p = project();
    let only = vec![p.path().join("src").join("style.css").to_string_lossy().into_owned()];
    let r = replace_all(p.path(), &opts("foo"), "baz", Some(&only)).unwrap();
    assert_eq!(r.files_changed, 1);
    assert!(fs::read_to_string(p.path().join("src/app.ts")).unwrap().contains("foo"));
    assert!(fs::read_to_string(p.path().join("src/style.css")).unwrap().contains(".baz"));
}
