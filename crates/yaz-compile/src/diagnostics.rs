//! Parsing TeX logs into structured, source-mapped diagnostics.
//!
//! This is engine-independent. TeX's log format, for all its faults, does not
//! vary meaningfully between engines, so parsing it once is correct and parsing
//! it per engine would be duplication.

use camino::Utf8PathBuf;

/// How serious a diagnostic is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    /// Compilation failed or produced a broken document.
    Error,
    /// Something is wrong but a PDF was still produced.
    Warning,
    /// Informational, e.g. an overfull box.
    Info,
}

/// A single diagnostic, mapped back onto a source location where possible.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    /// Severity.
    pub severity: Severity,
    /// The engine's own message text, always retained.
    pub message: String,
    /// Source file, when the log attributes one.
    pub file: Option<Utf8PathBuf>,
    /// 1-based line number, when the log attributes one.
    pub line: Option<u32>,
}

/// Parse a TeX log into diagnostics.
///
/// Two shapes carry almost all the useful information:
///
/// - `file:line: message` — emitted when the engine is run with
///   `-file-line-error`, which we always do. This is the only form that gives a
///   reliable source location.
/// - `! message` — the classic error form, with no location.
///
/// Warnings are matched loosely on `LaTeX Warning:` and `Package … Warning:`.
/// Overfull/underfull box notices are deliberately dropped: there are hundreds
/// in a real document and surfacing them buries the errors that matter.
pub fn parse_log(log: &str) -> Vec<Diagnostic> {
    let mut diagnostics = Vec::new();

    for line in log.lines() {
        let line = line.trim_end();

        if let Some(diagnostic) = parse_file_line_error(line) {
            diagnostics.push(diagnostic);
        } else if let Some(rest) = line.strip_prefix("! ") {
            diagnostics.push(Diagnostic {
                severity: Severity::Error,
                message: rest.trim().to_owned(),
                file: None,
                line: None,
            });
        } else if line.contains("Warning:") && !line.contains("Font Warning") {
            diagnostics.push(Diagnostic {
                severity: Severity::Warning,
                message: line.trim().to_owned(),
                file: None,
                line: None,
            });
        }
    }

    diagnostics
}

/// Parse the `-file-line-error` form: `./main.tex:42: Undefined control sequence`.
///
/// Care is needed on Windows, where an absolute path starts `C:\…` and a naive
/// split on the first colon takes the drive letter as the filename.
fn parse_file_line_error(line: &str) -> Option<Diagnostic> {
    // Split at the first ": " to separate location from message, then take the
    // *last* colon within the location as the line marker. Going right-to-left
    // there is what keeps a Windows drive letter attached to its path.
    let (location, message) = line.split_once(": ")?;

    let colon = location.rfind(':')?;
    let (file, number) = location.split_at(colon);
    let number: u32 = number.trim_start_matches(':').parse().ok()?;

    if file.is_empty() {
        return None;
    }

    Some(Diagnostic {
        severity: Severity::Error,
        message: message.trim().to_owned(),
        file: Some(Utf8PathBuf::from(file)),
        line: Some(number),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_file_line_errors() {
        let log = "./main.tex:42: Undefined control sequence.";
        let found = parse_log(log);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].severity, Severity::Error);
        assert_eq!(found[0].line, Some(42));
        assert_eq!(
            found[0].file.as_deref().map(|p| p.as_str()),
            Some("./main.tex")
        );
        assert_eq!(found[0].message, "Undefined control sequence.");
    }

    #[test]
    fn survives_windows_absolute_paths() {
        // A naive split on the first colon would call the file "C" and lose the
        // rest, which is the specific bug this guards.
        let log = r"C:\papers\main.tex:7: Missing $ inserted.";
        let found = parse_log(log);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].line, Some(7));
        assert_eq!(
            found[0].file.as_deref().map(|p| p.as_str()),
            Some(r"C:\papers\main.tex")
        );
    }

    #[test]
    fn parses_bang_errors_without_a_location() {
        let found = parse_log("! Emergency stop.");
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].severity, Severity::Error);
        assert!(found[0].file.is_none());
    }

    #[test]
    fn keeps_warnings_but_drops_box_noise() {
        let log = "\
LaTeX Warning: Reference `fig:one' on page 1 undefined.
Overfull \\hbox (12.0pt too wide) in paragraph at lines 5--6
Underfull \\vbox (badness 10000) has occurred while \\output is active";
        let found = parse_log(log);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].severity, Severity::Warning);
    }

    #[test]
    fn ignores_ordinary_log_chatter() {
        let log = "\
This is XeTeX, Version 3.141592653
Document Class: article 2024/02/08 v1.4n Standard LaTeX document class
(./main.tex";
        assert!(parse_log(log).is_empty());
    }
}
