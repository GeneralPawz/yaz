//! The capability broker — the enforcement point.
//!
//! Every privileged request from a plugin passes through [`Broker::authorise`].
//! There is no other path to the filesystem, the network, or a subprocess.
//!
//! # Invariants
//!
//! These are the properties the broker must hold. Each has a corresponding
//! adversarial test, and a change here without one should not be merged.
//!
//! 1. **Canonicalise before deciding.** A path is fully resolved — `..`
//!    components collapsed, symlinks followed — *before* it is compared against
//!    any root. Checking the requested path rather than the resolved one is the
//!    classic traversal escape.
//! 2. **Hosts are matched, not logged.** A network request to an undeclared host
//!    is refused, not permitted-with-a-warning.
//! 3. **Deny by default.** An unrecognised or malformed request is refused.
//! 4. **Every denial is recorded** in a log the user can inspect, attributed to
//!    the requesting plugin.
//!
//! # Why canonicalising a path that does not exist is the hard case
//!
//! A plugin writing a *new* file names a path with nothing at the end of it, so
//! `canonicalize` fails outright. Resolving only the existing ancestor and
//! rejoining the rest is what makes the check work for writes — and getting that
//! wrong in the other direction, by skipping canonicalisation when the file is
//! absent, would leave a hole that opens the moment a plugin picks a name that
//! does not exist yet.
//!
//! See [ADR-0006](https://github.com/GeneralPawz/yaz/blob/main/docs/adr/0006-plugin-runtime-and-capabilities.md).

use camino::{Utf8Path, Utf8PathBuf};
use std::sync::Mutex;

use crate::capability::Capability;

/// Why a request was refused.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[non_exhaustive]
pub enum Denied {
    /// The plugin never declared the capability in its manifest.
    #[error("plugin did not declare this capability")]
    NotDeclared,
    /// Declared, but the user has not granted it or has revoked it.
    #[error("capability declared but not granted by the user")]
    NotGranted,
    /// Declared and granted, but the specific target is outside its scope —
    /// a path outside the granted root, or an undeclared host.
    #[error("request is outside the granted scope of this capability")]
    OutOfScope,
}

impl Denied {
    /// The discriminant the frontend's `CapabilityError` carries.
    pub fn reason(&self) -> &'static str {
        match self {
            Denied::NotDeclared => "not-declared",
            Denied::NotGranted => "not-granted",
            Denied::OutOfScope => "out-of-scope",
        }
    }
}

/// A privileged operation a plugin is attempting.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub enum Request<'a> {
    /// Read a file.
    FsRead(&'a Utf8Path),
    /// Write a file.
    FsWrite(&'a Utf8Path),
    /// An HTTP request to a host.
    Net {
        /// Host only — never a full URL. See [`Broker::authorise`].
        host: &'a str,
    },
    /// Execute a binary.
    Process {
        /// The binary name or path being invoked.
        binary: &'a str,
    },
    /// Use the Zotero bridge.
    Zotero,
    /// Use the Obsidian bridge.
    Obsidian,
    /// Read or write the clipboard.
    Clipboard,
    /// Post a desktop notification.
    Notifications,
    /// Hand a URL or file to the system handler.
    ShellOpen,
}

/// A refusal, kept so the user can see what a plugin tried to do.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DenialRecord {
    /// The plugin that made the request.
    pub plugin_id: String,
    /// The capability that would have been needed.
    pub capability: String,
    /// A description of the target, safe to show the user.
    pub target: String,
    /// Why it was refused.
    pub reason: Denied,
}

/// Enforces capabilities for a single plugin.
#[derive(Debug)]
pub struct Broker {
    /// The plugin this broker serves.
    pub plugin_id: String,
    /// Capabilities the user has granted, which is the intersection of what the
    /// manifest declared and what the user approved.
    pub granted: Vec<Capability>,
    /// The open project root, canonicalised at construction.
    ///
    /// `None` when no project is open, in which case [`Capability::FsProject`]
    /// grants nothing — a capability scoped to a root that does not exist must
    /// not degrade into a capability scoped to everything.
    project_root: Option<Utf8PathBuf>,
    /// Refusals, most recent last.
    denials: Mutex<Vec<DenialRecord>>,
}

impl Broker {
    /// Build a broker for a plugin.
    ///
    /// The project root is canonicalised once here rather than on every request,
    /// because it does not change while a project is open and because a root
    /// that is itself a symlink would otherwise never match a canonicalised
    /// request path.
    pub fn new(
        plugin_id: impl Into<String>,
        granted: Vec<Capability>,
        project_root: Option<&Utf8Path>,
    ) -> Self {
        Self {
            plugin_id: plugin_id.into(),
            granted,
            project_root: project_root.and_then(canonicalise_existing),
            denials: Mutex::new(Vec::new()),
        }
    }

    /// Decide whether a request is permitted.
    ///
    /// # Network requests take a host, not a URL
    ///
    /// Passing a URL would put URL parsing inside the security boundary, and
    /// every interesting host-confusion trick — userinfo before an `@`,
    /// alternative encodings, embedded credentials — is a URL parsing bug. The
    /// caller parses; this compares hosts.
    pub fn authorise(&self, request: &Request<'_>) -> Result<(), Denied> {
        let result = self.decide(request);
        if let Err(reason) = &result {
            self.record(request, reason.clone());
        }
        result
    }

    fn decide(&self, request: &Request<'_>) -> Result<(), Denied> {
        match request {
            Request::FsRead(path) => self.authorise_path(path, false),
            Request::FsWrite(path) => self.authorise_path(path, true),

            Request::Net { host } => {
                // Invariant 2. An empty host cannot match anything, and must not
                // be treated as "no constraint".
                if host.is_empty() {
                    return Err(Denied::OutOfScope);
                }
                let declared = self
                    .granted
                    .iter()
                    .any(|c| matches!(c, Capability::Net { .. }));
                if !declared {
                    return Err(Denied::NotDeclared);
                }
                let permitted = self.granted.iter().any(|c| match c {
                    Capability::Net { hosts } => hosts.iter().any(|h| host_matches(h, host)),
                    _ => false,
                });
                if permitted {
                    Ok(())
                } else {
                    Err(Denied::OutOfScope)
                }
            }

            Request::Process { binary } => {
                let declared = self
                    .granted
                    .iter()
                    .any(|c| matches!(c, Capability::Process { .. }));
                if !declared {
                    return Err(Denied::NotDeclared);
                }
                let permitted = self.granted.iter().any(|c| match c {
                    Capability::Process { binaries } => binaries.iter().any(|b| b == binary),
                    _ => false,
                });
                if permitted {
                    Ok(())
                } else {
                    Err(Denied::OutOfScope)
                }
            }

            Request::Zotero => self.require(&Capability::Zotero),
            Request::Obsidian => self.require(&Capability::Obsidian),
            Request::Clipboard => self.require(&Capability::Clipboard),
            Request::Notifications => self.require(&Capability::Notifications),
            Request::ShellOpen => self.require(&Capability::ShellOpen),
        }
    }

    /// Simple presence check for capabilities that carry no scope.
    fn require(&self, needed: &Capability) -> Result<(), Denied> {
        if self.granted.contains(needed) {
            Ok(())
        } else {
            Err(Denied::NotDeclared)
        }
    }

    /// Invariant 1: resolve the path, then decide.
    fn authorise_path(&self, requested: &Utf8Path, writing: bool) -> Result<(), Denied> {
        let Some(resolved) = resolve_for_check(requested) else {
            // A path we cannot resolve is a path we cannot reason about.
            // Invariant 3.
            return Err(Denied::OutOfScope);
        };

        // The project root first: it is the common case and the cheapest.
        if self.granted.contains(&Capability::FsProject) {
            if let Some(root) = &self.project_root {
                if resolved.starts_with(root) {
                    return Ok(());
                }
            }
        }

        let mut declared_any = self.granted.contains(&Capability::FsProject);
        for capability in &self.granted {
            match capability {
                Capability::FsRead { path } => {
                    declared_any = true;
                    // A read-only grant must not authorise a write.
                    if !writing && within(&resolved, path) {
                        return Ok(());
                    }
                }
                Capability::FsWrite { path } => {
                    declared_any = true;
                    // A write grant implies read of the same location; a plugin
                    // that may replace a file can already learn its contents.
                    if within(&resolved, path) {
                        return Ok(());
                    }
                }
                _ => {}
            }
        }

        if declared_any {
            Err(Denied::OutOfScope)
        } else {
            Err(Denied::NotDeclared)
        }
    }

    fn record(&self, request: &Request<'_>, reason: Denied) {
        let (capability, target) = match request {
            Request::FsRead(path) => ("fs:read", path.to_string()),
            Request::FsWrite(path) => ("fs:write", path.to_string()),
            Request::Net { host } => ("net", (*host).to_owned()),
            Request::Process { binary } => ("process", (*binary).to_owned()),
            Request::Zotero => ("zotero", String::new()),
            Request::Obsidian => ("obsidian", String::new()),
            Request::Clipboard => ("clipboard", String::new()),
            Request::Notifications => ("notifications", String::new()),
            Request::ShellOpen => ("shell:open", String::new()),
        };
        // Invariant 4. A poisoned lock must not lose the audit trail, so the
        // record is written through the poison rather than dropped.
        let mut log = match self.denials.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        log.push(DenialRecord {
            plugin_id: self.plugin_id.clone(),
            capability: capability.to_owned(),
            target,
            reason,
        });
    }

    /// Every refusal this broker has issued.
    pub fn denials(&self) -> Vec<DenialRecord> {
        match self.denials.lock() {
            Ok(guard) => guard.clone(),
            Err(poisoned) => poisoned.into_inner().clone(),
        }
    }
}

/// Whether a resolved path lies inside a granted path.
///
/// The granted path is canonicalised here too. Comparing a canonical request
/// against a non-canonical grant is the same bug as not canonicalising at all,
/// just harder to spot.
fn within(resolved: &Utf8Path, granted: &Utf8Path) -> bool {
    match canonicalise_existing(granted) {
        Some(root) => resolved.starts_with(&root) || *resolved == root,
        None => false,
    }
}

/// Canonicalise a path that exists, normalising Windows' verbatim prefix.
fn canonicalise_existing(path: &Utf8Path) -> Option<Utf8PathBuf> {
    let canonical = std::fs::canonicalize(path.as_std_path()).ok()?;
    let utf8 = Utf8PathBuf::from_path_buf(canonical).ok()?;
    Some(strip_verbatim(&utf8))
}

/// Remove Windows' `\\?\` prefix so paths compare consistently.
///
/// `canonicalize` returns verbatim paths on Windows while a granted path from a
/// manifest never has the prefix, so without this every comparison on Windows
/// fails — which fails *closed*, but means the capability never works.
fn strip_verbatim(path: &Utf8Path) -> Utf8PathBuf {
    let text = path.as_str();
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        return Utf8PathBuf::from(format!(r"\\{rest}"));
    }
    if let Some(rest) = text.strip_prefix(r"\\?\") {
        return Utf8PathBuf::from(rest);
    }
    path.to_owned()
}

/// Resolve a request path far enough to decide about it.
///
/// The file itself need not exist — a plugin creating one is legitimate — but
/// everything that *does* exist on the way to it is resolved, so a symlinked
/// parent directory cannot be used to step outside the granted root.
fn resolve_for_check(requested: &Utf8Path) -> Option<Utf8PathBuf> {
    if let Some(canonical) = canonicalise_existing(requested) {
        return Some(canonical);
    }

    // Walk up to the nearest existing ancestor, then re-apply the remainder
    // with `..` collapsed. Collapsing is essential: `existing/../../../etc` must
    // not survive as literal components that `starts_with` would accept.
    let mut remainder: Vec<&str> = Vec::new();
    let mut cursor = requested;
    loop {
        let parent = cursor.parent()?;
        if parent.as_str().is_empty() {
            return None;
        }
        let name = cursor.file_name()?;
        remainder.push(name);
        if let Some(base) = canonicalise_existing(parent) {
            let mut resolved = base;
            for component in remainder.iter().rev() {
                match *component {
                    "." => {}
                    ".." => {
                        // Refuse rather than pop: a `..` above a resolved base
                        // is exactly the escape this exists to stop, and
                        // popping would silently permit it.
                        if !resolved.pop() {
                            return None;
                        }
                    }
                    other => resolved.push(other),
                }
            }
            return Some(resolved);
        }
        cursor = parent;
    }
}

/// Exact, case-insensitive host comparison.
///
/// Deliberately not a pattern match. Wildcard hosts are rejected at manifest
/// validation because a capability that grants "the internet" is not a
/// capability, and accepting `*.example.com` here would quietly reintroduce
/// them — along with every subdomain-takeover that implies.
fn host_matches(declared: &str, requested: &str) -> bool {
    declared.eq_ignore_ascii_case(requested)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn utf8(path: &std::path::Path) -> Utf8PathBuf {
        Utf8PathBuf::from_path_buf(path.to_path_buf()).unwrap()
    }

    fn broker_with(granted: Vec<Capability>, root: Option<&Utf8Path>) -> Broker {
        Broker::new("com.example.test", granted, root)
    }

    #[test]
    fn deny_by_default() {
        let broker = broker_with(Vec::new(), None);
        assert_eq!(broker.authorise(&Request::Zotero), Err(Denied::NotDeclared));
        assert_eq!(
            broker.authorise(&Request::Net {
                host: "example.com"
            }),
            Err(Denied::NotDeclared)
        );
        assert_eq!(
            broker.authorise(&Request::Clipboard),
            Err(Denied::NotDeclared)
        );
    }

    #[test]
    fn a_granted_scopeless_capability_is_allowed() {
        let broker = broker_with(vec![Capability::Zotero], None);
        assert_eq!(broker.authorise(&Request::Zotero), Ok(()));
        // ...and grants nothing else.
        assert_eq!(
            broker.authorise(&Request::Obsidian),
            Err(Denied::NotDeclared)
        );
    }

    #[test]
    fn traversal_out_of_the_project_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let root = utf8(dir.path());
        std::fs::create_dir_all(root.join("sub").as_std_path()).unwrap();
        std::fs::write(root.join("sub/inside.tex").as_std_path(), "x").unwrap();

        let broker = broker_with(vec![Capability::FsProject], Some(&root));
        assert_eq!(
            broker.authorise(&Request::FsRead(&root.join("sub/inside.tex"))),
            Ok(())
        );

        // The classic escape. Note this path is *syntactically* under the root.
        let escape = root.join("sub/../../../../etc/passwd");
        assert_eq!(
            broker.authorise(&Request::FsRead(&escape)),
            Err(Denied::OutOfScope),
            "a `..` chain must be collapsed before the containment check"
        );
    }

    #[test]
    fn a_sibling_directory_sharing_a_prefix_is_not_inside() {
        // `/tmp/proj` must not authorise `/tmp/proj-secrets`. A naive string
        // prefix check gets this wrong.
        let dir = tempfile::tempdir().unwrap();
        let base = utf8(dir.path());
        let project = base.join("proj");
        let sibling = base.join("proj-secrets");
        std::fs::create_dir_all(project.as_std_path()).unwrap();
        std::fs::create_dir_all(sibling.as_std_path()).unwrap();
        std::fs::write(sibling.join("keys.txt").as_std_path(), "x").unwrap();

        let broker = broker_with(vec![Capability::FsProject], Some(&project));
        assert_eq!(
            broker.authorise(&Request::FsRead(&sibling.join("keys.txt"))),
            Err(Denied::OutOfScope)
        );
    }

    #[test]
    fn a_file_that_does_not_exist_yet_can_still_be_written_inside_the_root() {
        // The write path: `canonicalize` fails on the target itself, and the
        // check has to work anyway or no plugin could ever create a file.
        let dir = tempfile::tempdir().unwrap();
        let root = utf8(dir.path());
        let broker = broker_with(vec![Capability::FsProject], Some(&root));
        assert_eq!(
            broker.authorise(&Request::FsWrite(&root.join("brand-new.bib"))),
            Ok(())
        );
        assert_eq!(
            broker.authorise(&Request::FsWrite(&root.join("nested/new/deep.bib"))),
            Ok(())
        );
    }

    #[test]
    fn a_nonexistent_path_cannot_traverse_out_either() {
        // The dangerous half of the same case: resolving only the existing
        // ancestor must still collapse `..` in the remainder.
        let dir = tempfile::tempdir().unwrap();
        let root = utf8(dir.path());
        let broker = broker_with(vec![Capability::FsProject], Some(&root));
        assert_eq!(
            broker.authorise(&Request::FsWrite(&root.join("../escaped.txt"))),
            Err(Denied::OutOfScope)
        );
        assert_eq!(
            broker.authorise(&Request::FsWrite(&root.join("a/../../escaped.txt"))),
            Err(Denied::OutOfScope)
        );
    }

    #[test]
    fn a_symlink_out_of_the_project_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let base = utf8(dir.path());
        let project = base.join("project");
        let outside = base.join("outside");
        std::fs::create_dir_all(project.as_std_path()).unwrap();
        std::fs::create_dir_all(outside.as_std_path()).unwrap();
        std::fs::write(outside.join("secret.txt").as_std_path(), "x").unwrap();

        let link = project.join("escape");
        #[cfg(unix)]
        let made = std::os::unix::fs::symlink(outside.as_std_path(), link.as_std_path()).is_ok();
        #[cfg(windows)]
        let made =
            std::os::windows::fs::symlink_dir(outside.as_std_path(), link.as_std_path()).is_ok();

        if !made {
            // Creating a symlink on Windows needs Developer Mode or elevation.
            // Skipping is honest; silently passing would not be.
            eprintln!("skipping: could not create a symlink in this environment");
            return;
        }

        let broker = broker_with(vec![Capability::FsProject], Some(&project));
        assert_eq!(
            broker.authorise(&Request::FsRead(&link.join("secret.txt"))),
            Err(Denied::OutOfScope),
            "symlinks must be followed before the containment check"
        );
    }

    #[test]
    fn fs_project_grants_nothing_when_no_project_is_open() {
        // A root-scoped capability with no root must not widen to everything.
        let dir = tempfile::tempdir().unwrap();
        let stray = utf8(dir.path()).join("file.txt");
        std::fs::write(stray.as_std_path(), "x").unwrap();

        let broker = broker_with(vec![Capability::FsProject], None);
        assert_eq!(
            broker.authorise(&Request::FsRead(&stray)),
            Err(Denied::OutOfScope)
        );
    }

    #[test]
    fn a_read_grant_does_not_authorise_a_write() {
        let dir = tempfile::tempdir().unwrap();
        let readable = utf8(dir.path());
        let file = readable.join("notes.md");
        std::fs::write(file.as_std_path(), "x").unwrap();

        let broker = broker_with(
            vec![Capability::FsRead {
                path: readable.clone(),
            }],
            None,
        );
        assert_eq!(broker.authorise(&Request::FsRead(&file)), Ok(()));
        assert_eq!(
            broker.authorise(&Request::FsWrite(&file)),
            Err(Denied::OutOfScope),
            "read access must not escalate to write"
        );
    }

    #[test]
    fn a_write_grant_also_permits_reading_the_same_place() {
        let dir = tempfile::tempdir().unwrap();
        let writable = utf8(dir.path());
        let file = writable.join("out.bib");
        std::fs::write(file.as_std_path(), "x").unwrap();

        let broker = broker_with(
            vec![Capability::FsWrite {
                path: writable.clone(),
            }],
            None,
        );
        assert_eq!(broker.authorise(&Request::FsWrite(&file)), Ok(()));
        assert_eq!(broker.authorise(&Request::FsRead(&file)), Ok(()));
    }

    #[test]
    fn hosts_are_matched_exactly() {
        let broker = broker_with(
            vec![Capability::Net {
                hosts: vec!["127.0.0.1".to_owned()],
            }],
            None,
        );
        assert_eq!(
            broker.authorise(&Request::Net { host: "127.0.0.1" }),
            Ok(())
        );
        // Case folding is legitimate for hostnames.
        let broker2 = broker_with(
            vec![Capability::Net {
                hosts: vec!["api.crossref.org".to_owned()],
            }],
            None,
        );
        assert_eq!(
            broker2.authorise(&Request::Net {
                host: "API.CrossRef.ORG"
            }),
            Ok(())
        );
    }

    #[test]
    fn a_lookalike_host_is_refused() {
        let broker = broker_with(
            vec![Capability::Net {
                hosts: vec!["api.crossref.org".to_owned()],
            }],
            None,
        );
        for host in [
            "evil.com",
            "api.crossref.org.evil.com",
            "notapi.crossref.org",
            "crossref.org",
            "",
        ] {
            assert_eq!(
                broker.authorise(&Request::Net { host }),
                Err(Denied::OutOfScope),
                "host {host:?} must not match"
            );
        }
    }

    #[test]
    fn a_wildcard_in_a_grant_is_not_a_wildcard() {
        // Manifest validation rejects these, but the broker must not honour one
        // even if it somehow arrives.
        let broker = broker_with(
            vec![Capability::Net {
                hosts: vec!["*.example.com".to_owned()],
            }],
            None,
        );
        assert_eq!(
            broker.authorise(&Request::Net {
                host: "anything.example.com"
            }),
            Err(Denied::OutOfScope)
        );
    }

    #[test]
    fn binaries_are_matched_exactly() {
        let broker = broker_with(
            vec![Capability::Process {
                binaries: vec!["latexmk".to_owned()],
            }],
            None,
        );
        assert_eq!(
            broker.authorise(&Request::Process { binary: "latexmk" }),
            Ok(())
        );
        for binary in ["latexmk.evil", "/usr/bin/latexmk", "sh", ""] {
            assert_eq!(
                broker.authorise(&Request::Process { binary }),
                Err(Denied::OutOfScope),
                "binary {binary:?} must not match"
            );
        }
    }

    #[test]
    fn every_denial_is_recorded_and_attributed() {
        let broker = broker_with(vec![Capability::Zotero], None);
        assert!(broker.denials().is_empty());

        let _ = broker.authorise(&Request::Net {
            host: "exfiltrate.example",
        });
        let _ = broker.authorise(&Request::Obsidian);
        // A permitted request leaves no denial behind.
        let _ = broker.authorise(&Request::Zotero);

        let denials = broker.denials();
        assert_eq!(denials.len(), 2);
        assert!(denials.iter().all(|d| d.plugin_id == "com.example.test"));
        assert_eq!(denials[0].capability, "net");
        assert_eq!(denials[0].target, "exfiltrate.example");
        assert_eq!(denials[0].reason, Denied::NotDeclared);
        assert_eq!(denials[1].capability, "obsidian");
    }

    #[test]
    fn denial_reasons_match_the_frontend_discriminants() {
        // These strings are the `CapabilityError.reason` union in @yaz/api.
        assert_eq!(Denied::NotDeclared.reason(), "not-declared");
        assert_eq!(Denied::NotGranted.reason(), "not-granted");
        assert_eq!(Denied::OutOfScope.reason(), "out-of-scope");
    }

    #[test]
    fn the_verbatim_prefix_is_normalised_away() {
        assert_eq!(
            strip_verbatim(Utf8Path::new(r"\\?\D:\projects\yaz")),
            Utf8PathBuf::from(r"D:\projects\yaz")
        );
        assert_eq!(
            strip_verbatim(Utf8Path::new(r"\\?\UNC\server\share")),
            Utf8PathBuf::from(r"\\server\share")
        );
        assert_eq!(
            strip_verbatim(Utf8Path::new("/home/x/proj")),
            Utf8PathBuf::from("/home/x/proj")
        );
    }
}
