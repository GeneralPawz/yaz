//! The workspace: which projects are open and how panes are arranged.
//!
//! Pane layout is core rather than a plugin concern because plugins register
//! views into it. See
//! [ADR-0005](https://github.com/GeneralPawz/yaz/blob/main/docs/adr/0005-extensibility-tiers.md).

use crate::project::Project;

/// The set of open projects and the layout state around them.
#[derive(Debug, Default)]
pub struct Workspace {
    /// Currently open projects, in the order they were opened.
    pub projects: Vec<Project>,
}

// TODO(phase-2): pane tree, view registration, session persistence.
