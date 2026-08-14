//! End-to-end compilation against the fixture project.
//!
//! Skips rather than fails when no TeX distribution is installed. CI's Linux
//! runners have none, and a test that fails on "the machine lacks an optional
//! external tool" trains people to ignore red builds.

use camino::Utf8PathBuf;
use yaz_compile::{CompileEngine, SystemEngine};
use yaz_core::project::{EngineChoice, Project};

fn fixture_root() -> Utf8PathBuf {
    Utf8PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures/minimal")
        .canonicalize_utf8()
        .expect("fixture directory should exist")
}

#[test]
fn compiles_the_minimal_fixture() {
    let Some(engine) = SystemEngine::detect_all().into_iter().next() else {
        eprintln!("no system TeX distribution found; skipping");
        return;
    };

    let root = fixture_root();
    let project = Project {
        root: root.clone(),
        entry: Utf8PathBuf::from("main.tex"),
        engine: EngineChoice::System {
            engine: engine.engine.clone(),
        },
        document_locale: None,
    };

    let output = engine.compile(&project).expect("compile should run");

    // Clean up before asserting, so a failure does not leave the working tree
    // dirty for the next run.
    let build_dir = root.join("build");

    let produced_pdf = output.pdf.clone();
    let errors: Vec<_> = output
        .diagnostics
        .iter()
        .filter(|d| d.severity == yaz_compile::diagnostics::Severity::Error)
        .collect();

    let error_summary = format!("{errors:#?}");
    let _ = std::fs::remove_dir_all(&build_dir);

    assert!(
        produced_pdf.is_some(),
        "expected a PDF from {}; diagnostics: {error_summary}",
        engine.engine
    );
    assert!(
        output.succeeded,
        "expected success; diagnostics: {error_summary}"
    );
}

#[test]
fn reports_availability_honestly() {
    // A named engine that cannot possibly exist must report itself unavailable
    // rather than failing later with a confusing spawn error.
    let bogus = SystemEngine::new("definitely-not-a-real-typesetter");
    assert!(!bogus.is_available());
}
