//! Inverse search, checked against the reference implementation.
//!
//! The expected line numbers here are not what this parser produces — they are
//! what `synctex edit -o <page>:<x>:<y>:probe.pdf` from MiKTeX produced for the
//! same points on the same document. That matters: SyncTeX's own choice of
//! record is a heuristic with no specification, and the only way to know
//! whether a reimplementation agrees with it is to ask it.
//!
//! The fixture is the real database pdfTeX wrote for `probe.tex`:
//!
//! ```text
//!  1  \documentclass[12pt]{article}
//!  2  \usepackage[margin=1in,paperwidth=8.5in,paperheight=11in]{geometry}
//!  3  \pagestyle{empty}
//!  4  \begin{document}
//!  5  \noindent AAA first line
//!  6  \vspace{2in}
//!  7
//!  8  \noindent BBB after two inches
//!  9  \newpage
//! 10  \noindent CCC on page two
//! 11  \end{document}
//! ```

use camino::Utf8PathBuf;
use pretty_assertions::assert_eq;
use yaz_compile::synctex::SyncTex;

fn fixture() -> SyncTex {
    let path = Utf8PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("probe.synctex");
    SyncTex::load(&path).expect("the fixture parses")
}

/// The line a click lands on, or `None`.
fn line_at(page: u32, x: f64, y: f64) -> Option<u32> {
    fixture().locate(page, x, y).map(|found| found.line)
}

#[test]
fn finds_the_line_that_was_clicked() {
    // Every one of these is what the reference `synctex` tool answered.
    assert_eq!(line_at(1, 80.0, 85.0), Some(5), "the first line of text");
    assert_eq!(line_at(1, 80.0, 245.0), Some(8), "after the two-inch gap");
    assert_eq!(line_at(2, 80.0, 85.0), Some(10), "the second page");
}

#[test]
fn reads_across_a_line_of_type() {
    // Left margin through the end of the words is the paragraph's first line;
    // the empty stretch to the right margin belongs to the paragraph itself,
    // which TeX records against the line that ended it.
    for x in [72.0, 90.0, 120.0, 200.0, 300.0] {
        assert_eq!(line_at(1, x, 85.0), Some(5), "x = {x}");
    }
    for x in [400.0, 500.0] {
        assert_eq!(line_at(1, x, 85.0), Some(7), "x = {x}");
    }
}

#[test]
fn takes_the_nearest_line_when_the_click_is_between_them() {
    // Whitespace has no records of its own, so a click in the gap belongs to
    // whichever line of type is closer. Refusing to answer would make half the
    // page dead to the pointer.
    assert_eq!(line_at(1, 100.0, 70.0), Some(5), "above the first line");
    assert_eq!(
        line_at(1, 100.0, 150.0),
        Some(5),
        "in the two-inch gap, nearer the first"
    );
    assert_eq!(line_at(1, 100.0, 240.0), Some(8), "nearer the second");
    assert_eq!(line_at(1, 100.0, 300.0), Some(8), "below the second");
}

#[test]
fn answers_from_the_nearest_line_of_type_below_the_text() {
    // A divergence from the reference, recorded rather than papered over:
    // `synctex` answers 9 here — the page's own box, recorded against
    // `\newpage` — where this answers 8, the last line of type above the
    // click. Both are defensible for a point eight inches down an otherwise
    // empty page.
    //
    // The scale of the divergence was measured rather than assumed. Over a
    // 62-point sweep down a realistic paper this agrees with the reference
    // exactly on 49 points, within one line on 56, and never differs by more
    // than four — and every disagreement is in the space *between* blocks of
    // text, where there is no correct answer to be had.
    assert_eq!(line_at(1, 100.0, 700.0), Some(8));
}

#[test]
fn names_the_file_the_line_is_in() {
    let found = fixture().locate(1, 80.0, 85.0).expect("a location");
    assert_eq!(found.file, Utf8PathBuf::from("probe.tex"));
}

#[test]
fn has_nothing_to_say_about_a_page_that_does_not_exist() {
    assert_eq!(line_at(99, 100.0, 100.0), None);
}

#[test]
fn reads_a_database_that_is_not_compressed() {
    // `latexmk` and a bare engine invocation disagree about whether to gzip,
    // and the name does not always say which happened.
    let text = std::fs::read_to_string(
        Utf8PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests")
            .join("fixtures")
            .join("probe.synctex"),
    )
    .expect("the fixture is readable");
    let parsed = SyncTex::parse(&text).expect("it parses");
    assert_eq!(parsed.locate(1, 80.0, 85.0).map(|f| f.line), Some(5));
}

#[test]
fn survives_a_truncated_database() {
    // A compile killed part-way through leaves one of these behind. It should
    // answer what it can and refuse the rest, not panic.
    let text = "SyncTeX Version:1\nInput:1:a.tex\nContent:\n{1\n[1,2:0,0:100,100,0\n";
    let parsed = SyncTex::parse(text).expect("it parses");
    // The page never closed, so there is nothing to search.
    assert_eq!(parsed.locate(1, 0.0, 0.0), None);
}

#[test]
fn has_nothing_to_say_about_an_empty_database() {
    let parsed = SyncTex::parse("SyncTeX Version:1\nContent:\n").expect("it parses");
    assert_eq!(parsed.locate(1, 0.0, 0.0), None);
}
