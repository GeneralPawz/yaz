//! The Markdown-to-LaTeX mapping.
//!
//! The mapping is **data, not code**: a TOML file in the project, with our
//! default shipped and every rule overridable. This is the crate's central
//! design choice, and it exists because there is no correct universal mapping —
//! one person's `[[wikilink]]` is a citation and another's is a cross-reference.

use serde::{Deserialize, Serialize};

/// What a `[[wikilink]]` becomes in LaTeX when it cannot be resolved to a
/// citation key or a labelled section.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum UnresolvedLink {
    /// Emit `\hyperref` to the translated note.
    #[default]
    Hyperref,
    /// Emit a footnote containing the note title.
    Footnote,
    /// Emit the link text and record it in the unresolved list for review.
    PlainWithWarning,
}

/// The full mapping configuration, loaded from `obsidian-mapping.toml`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Mapping {
    /// LaTeX sectioning commands by Markdown heading depth, index 0 being `#`.
    pub heading_commands: Vec<String>,
    /// Environment name each callout type maps to, e.g. `note` → `quote`.
    pub callout_environments: std::collections::BTreeMap<String, String>,
    /// Behaviour for wikilinks we cannot resolve.
    pub unresolved_link: UnresolvedLink,
}

impl Default for Mapping {
    fn default() -> Self {
        Self {
            heading_commands: vec![
                "section".to_owned(),
                "subsection".to_owned(),
                "subsubsection".to_owned(),
                "paragraph".to_owned(),
            ],
            callout_environments: Default::default(),
            unresolved_link: UnresolvedLink::default(),
        }
    }
}
