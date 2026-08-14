//! End-to-end compilation with the embedded Typst engine.
//!
//! Unlike the Tectonic and system engines there is nothing to skip for: Typst is
//! compiled in, needs no external installation and no network, so this test
//! either passes or the engine is broken.

#![cfg(feature = "typst-engine")]

use camino::Utf8PathBuf;
use yaz_compile::{CompileEngine, TypstEngine};
use yaz_core::project::{EngineChoice, Project};

fn fixture_root() -> Utf8PathBuf {
    Utf8PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures/typst-minimal")
        .canonicalize_utf8()
        .expect("fixture directory should exist")
}

#[test]
fn compiles_the_minimal_typst_fixture() {
    let root = fixture_root();
    let project = Project {
        root: root.clone(),
        entry: Utf8PathBuf::from("main.typ"),
        engine: EngineChoice::Typst,
        document_locale: None,
    };

    let engine = TypstEngine::new();
    let output = engine.compile(&project).expect("compile should run");

    let build_dir = root.join("build");
    let pdf = output.pdf.clone();
    let diagnostics = format!("{:#?}", output.diagnostics);
    let succeeded = output.succeeded;

    // Clean up before asserting so a failure does not leave the tree dirty.
    let _ = std::fs::remove_dir_all(&build_dir);

    assert!(succeeded, "expected success; diagnostics: {diagnostics}");
    let pdf = pdf.expect("expected a PDF path");
    assert!(pdf.as_str().ends_with(".pdf"), "unexpected artefact: {pdf}");
}

#[test]
fn a_syntax_error_is_reported_rather_than_panicking() {
    let dir = tempfile::tempdir().expect("temp dir");
    let root = camino::Utf8Path::from_path(dir.path()).expect("utf8 path");
    // `#let` with no binding is a parse error.
    std::fs::write(root.join("broken.typ"), "#let = \n").expect("write");

    let project = Project {
        root: root.to_owned(),
        entry: Utf8PathBuf::from("broken.typ"),
        engine: EngineChoice::Typst,
        document_locale: None,
    };

    let output = TypstEngine::new()
        .compile(&project)
        .expect("a broken document is a compile result, not an error");

    assert!(!output.succeeded);
    assert!(output.pdf.is_none());
    assert!(
        !output.diagnostics.is_empty(),
        "a failed compile must say why"
    );
}
