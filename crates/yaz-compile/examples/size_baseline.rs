//! Baseline counterpart to `size_probe`.
//!
//! Links the same crate *without* the embedded engine, so the difference
//! between the two release binaries is Tectonic's actual contribution to what
//! we ship. Measuring the probe alone would give an absolute number that also
//! includes the Rust runtime and everything else yaz-compile pulls in.
//!
//! It touches only `Severity`, which exists no matter which engines are
//! compiled in. Referencing an engine type or the log parser would tie the
//! baseline to whichever of those happen to exist on a given branch, and this
//! example has to build everywhere.

use yaz_compile::diagnostics::Severity;

fn main() {
    let severity = Severity::Error;
    println!("baseline links yaz-compile; sample severity = {severity:?}");
}
