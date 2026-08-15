//! The brokered command surface plugins reach the system through.
//!
//! Every command here takes a `plugin_id`, looks up that plugin's
//! [`Broker`](yaz_plugin::Broker), and refuses before doing any work. There is
//! no unbrokered path: a command that skipped this would be the private back
//! door [ADR-0005] exists to forbid, and the Zotero bridge is a core plugin
//! precisely so that it has to live with the same API an external author gets.
//!
//! # What `plugin_id` does and does not prove
//!
//! It is supplied by the webview, so it identifies the *caller's claim*, not the
//! caller. Plugins share one JavaScript realm ([ADR-0006]), which means one
//! plugin can already read another's memory, overlay its interface, and — here —
//! name its id. **Capabilities therefore bound what the plugin layer as a whole
//! can do, not what one plugin can do relative to another.**
//!
//! A per-plugin token handed out at load would raise the bar slightly and would
//! not change that conclusion, because any plugin able to name another's id can
//! equally read its token out of the shared realm. Adding one would make the
//! boundary look stronger than it is, which is worse than stating the limit, so
//! this is stated rather than decorated. `SECURITY.md` says the same thing about
//! the DOM.
//!
//! What the broker does buy is real: a plugin cannot reach the filesystem
//! outside the granted roots, cannot reach an undeclared host, and cannot
//! execute an undeclared binary — regardless of what it claims to be.
//!
//! [ADR-0005]: https://github.com/GeneralPawz/yaz/blob/main/docs/adr/0005-extensibility-tiers.md
//! [ADR-0006]: https://github.com/GeneralPawz/yaz/blob/main/docs/adr/0006-plugin-runtime-and-capabilities.md

use camino::{Utf8Path, Utf8PathBuf};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

use yaz_plugin::{Broker, Capability, Denied, Request};
use yaz_zotero::{ActiveSource, Library};

use crate::commands::CommandError;

type Result<T> = std::result::Result<T, CommandError>;

/// The bundled core plugins, compiled in from their own manifests.
///
/// The manifest is the declaration of what a plugin wants, so it is the thing
/// read here — **not** a capability list supplied by the webview. Letting the
/// frontend name its own capabilities would make the broker decorative: a
/// plugin would simply ask for what it needed at the moment it needed it.
///
/// Core plugins are compiled in rather than read from disk because that is what
/// "bundled" means; community plugins arrive from a release archive later, and
/// their manifests are read and diffed at install time ([ADR-0013]).
///
/// [ADR-0013]: https://github.com/GeneralPawz/yaz/blob/main/docs/adr/0013-update-distribution.md
const CORE_MANIFESTS: &[&str] = &[include_str!("../../../plugins/zotero/manifest.json")];

/// A core plugin the application ships with.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CorePlugin {
    id: String,
    name: String,
    description: String,
    /// Capability identifiers, for the interface to explain what it can do.
    capabilities: Vec<String>,
}

/// Everything the plugin layer needs, held as Tauri state.
pub struct PluginHost {
    /// One broker per loaded plugin.
    brokers: RwLock<HashMap<String, Arc<Broker>>>,
    /// The Zotero library, connected lazily on first use.
    ///
    /// Lazy on purpose: probing a closed Zotero costs a connection timeout, and
    /// paying it during startup would push time-to-interactive up for every user
    /// including those who never open the citation picker ([ADR-0015]).
    ///
    /// [ADR-0015]: https://github.com/GeneralPawz/yaz/blob/main/docs/adr/0015-performance-budgets.md
    zotero: RwLock<Option<Arc<Library>>>,
    /// The open project root, which scopes [`Capability::FsProject`].
    project_root: RwLock<Option<Utf8PathBuf>>,
    /// An explicit Zotero data directory, overriding discovery.
    ///
    /// Discovery is right for almost everyone, but a machine can hold several
    /// Zotero profiles pointing at different libraries, and the user needs a way
    /// to say which. It is also what makes this testable against a fixture
    /// rather than against whoever's library happens to be on the build machine.
    zotero_data_dir: RwLock<Option<Utf8PathBuf>>,
}

impl Default for PluginHost {
    fn default() -> Self {
        Self::new()
    }
}

impl PluginHost {
    /// An empty host with no plugins loaded.
    pub fn new() -> Self {
        Self {
            brokers: RwLock::new(HashMap::new()),
            zotero: RwLock::new(None),
            project_root: RwLock::new(None),
            zotero_data_dir: RwLock::new(None),
        }
    }

    /// Point the Zotero bridge at a specific data directory.
    ///
    /// Drops any connected library, so the next call re-probes against the new
    /// location rather than answering from the old one.
    pub async fn set_zotero_data_dir(&self, dir: Option<Utf8PathBuf>) {
        *self.zotero_data_dir.write().await = dir;
        *self.zotero.write().await = None;
    }

    /// Grant a plugin its capabilities, replacing any previous grant.
    pub async fn load(&self, plugin_id: &str, granted: Vec<Capability>) {
        let root = self.project_root.read().await.clone();
        let broker = Broker::new(plugin_id, granted, root.as_deref());
        self.brokers
            .write()
            .await
            .insert(plugin_id.to_owned(), Arc::new(broker));
    }

    /// Point the filesystem capabilities at a new project root.
    ///
    /// Brokers are rebuilt rather than mutated: the root is canonicalised at
    /// construction, and a broker still scoped to the previous project would
    /// authorise writes into a project the user has closed.
    pub async fn set_project_root(&self, root: Option<&Utf8Path>) {
        *self.project_root.write().await = root.map(Utf8Path::to_path_buf);

        let existing: Vec<(String, Vec<Capability>)> = self
            .brokers
            .read()
            .await
            .iter()
            .map(|(id, broker)| (id.clone(), broker.granted.clone()))
            .collect();

        let mut brokers = self.brokers.write().await;
        for (id, granted) in existing {
            brokers.insert(id.clone(), Arc::new(Broker::new(id, granted, root)));
        }
    }

    async fn broker(&self, plugin_id: &str) -> Result<Arc<Broker>> {
        self.brokers
            .read()
            .await
            .get(plugin_id)
            .cloned()
            .ok_or_else(|| CommandError::new("plugin-error-not-loaded", plugin_id))
    }

    /// Authorise a request, converting a refusal into an IPC error.
    async fn authorise(&self, plugin_id: &str, request: &Request<'_>) -> Result<()> {
        let broker = self.broker(plugin_id).await?;
        broker
            .authorise(request)
            .map_err(|denied| denied_error(&denied))
    }

    /// The Zotero library, connecting on first use.
    async fn library(&self) -> Result<Arc<Library>> {
        if let Some(library) = self.zotero.read().await.as_ref() {
            return Ok(library.clone());
        }

        let mut slot = self.zotero.write().await;
        // Re-check: another task may have connected while this one waited.
        if let Some(library) = slot.as_ref() {
            return Ok(library.clone());
        }

        let http = yaz_core::net::http_client()
            .map_err(|error| CommandError::new("zotero-error-http", error))?;
        let config = yaz_zotero::Config {
            data_dir: self.zotero_data_dir.read().await.clone(),
            scratch: Utf8PathBuf::from_path_buf(std::env::temp_dir())
                .unwrap_or_else(|_| Utf8PathBuf::from(".")),
        };
        let library = Arc::new(Library::connect(&config, http).await);
        *slot = Some(library.clone());
        Ok(library)
    }

    /// Load every bundled core plugin, granting what its manifest declares.
    ///
    /// Core plugins are enabled by default ([ADR-0005]); a user who does not use
    /// Zotero can disable the plugin, which is the granularity that decision
    /// chose. A malformed bundled manifest is a build error in disguise, so it
    /// is logged loudly rather than silently skipped.
    ///
    /// [ADR-0005]: https://github.com/GeneralPawz/yaz/blob/main/docs/adr/0005-extensibility-tiers.md
    pub async fn load_core_plugins(&self) -> Vec<CorePlugin> {
        let mut loaded = Vec::new();
        for source in CORE_MANIFESTS {
            match serde_json::from_str::<yaz_plugin::Manifest>(source) {
                Ok(manifest) => {
                    let capabilities: Vec<String> = manifest
                        .capabilities
                        .iter()
                        .map(|c| c.id().to_owned())
                        .collect();
                    self.load(&manifest.id, manifest.capabilities.clone()).await;
                    tracing::info!(
                        plugin = %manifest.id,
                        capabilities = ?capabilities,
                        "core plugin loaded"
                    );
                    loaded.push(CorePlugin {
                        id: manifest.id,
                        name: manifest.name,
                        description: manifest.description,
                        capabilities,
                    });
                }
                Err(error) => {
                    tracing::error!(%error, "a bundled core plugin manifest did not parse");
                }
            }
        }
        loaded
    }

    /// Ensure an item exists in the project bibliography, and return its key.
    ///
    /// [ADR-0008] makes the project `.bib` the compile-time source of truth, so
    /// this copies the entry into the project rather than pointing at the
    /// library — a document must build on a co-author's machine that has never
    /// had Zotero installed.
    ///
    /// The read-modify-write happens here rather than in the plugin because it
    /// is one operation: a plugin doing it over three separate brokered calls
    /// could interleave with itself and lose an entry.
    ///
    /// [ADR-0008]: https://github.com/GeneralPawz/yaz/blob/main/docs/adr/0008-zotero-integration.md
    pub async fn ensure_in_bibliography(
        &self,
        plugin_id: &str,
        root: &Utf8Path,
        item_key: &str,
        bibliography: Option<String>,
    ) -> Result<CitationKey> {
        self.authorise(plugin_id, &Request::Zotero).await?;

        let relative = bibliography.unwrap_or_else(|| "references.bib".to_owned());
        let bib_path = root.join(&relative);

        // The write is authorised separately and explicitly. Holding the Zotero
        // capability must not imply permission to write to the disk.
        self.authorise(plugin_id, &Request::FsWrite(&bib_path))
            .await?;

        let library = self.library().await?;
        // A lookup, not a search. Search matches titles and creator surnames, so
        // passing a key to it finds nothing at all — this originally did exactly
        // that, and every citation insert failed until a test caught it.
        let item = library
            .find(item_key)
            .await
            .map_err(zotero_error)?
            .ok_or_else(|| CommandError::new("zotero-error-item-not-found", item_key))?;

        let existing = std::fs::read_to_string(bib_path.as_std_path()).unwrap_or_default();
        let taken = yaz_zotero::bib::existing_keys(&existing);

        // An entry already written for this item is found by its key, so citing
        // the same source twice does not append a duplicate.
        let base = item
            .citation_key
            .clone()
            .unwrap_or_else(|| yaz_zotero::bib::generate_key(&item));
        if taken.contains(&base) {
            return Ok(CitationKey {
                key: base,
                added: false,
                bibliography: relative,
                is_authoritative: item.citation_key.is_some(),
            });
        }

        let key = yaz_zotero::bib::disambiguate(&base, &taken);
        let entry = yaz_zotero::bib::to_bibtex(&item, &key);

        // Separate entries with a blank line, without introducing one at the
        // top of a file that did not exist a moment ago.
        let mut contents = existing;
        if !contents.is_empty() {
            if !contents.ends_with('\n') {
                contents.push('\n');
            }
            contents.push('\n');
        }
        contents.push_str(&entry);

        if let Some(parent) = bib_path.parent() {
            std::fs::create_dir_all(parent.as_std_path())
                .map_err(|error| CommandError::new("zotero-error-io", error))?;
        }
        std::fs::write(bib_path.as_std_path(), contents)
            .map_err(|error| CommandError::new("zotero-error-io", error))?;

        Ok(CitationKey {
            key,
            added: true,
            bibliography: relative,
            is_authoritative: item.citation_key.is_some(),
        })
    }

    /// Drop the cached library so the next call re-probes.
    ///
    /// A user who starts Zotero mid-session should not have to restart yaz to be
    /// upgraded from the offline copy to the live library.
    pub async fn reconnect_zotero(&self) {
        *self.zotero.write().await = None;
    }
}

fn denied_error(denied: &Denied) -> CommandError {
    let detail = denied.reason();
    // Each arm constructs its own error rather than selecting a key and
    // constructing once. That is slightly more verbose and it is what makes the
    // keys visible to `scripts/check-i18n.mjs`, which matches literal arguments
    // to `CommandError::new` — a key computed into a variable is a key nothing
    // verifies (ADR-0011).
    //
    // `Denied` is `#[non_exhaustive]`, so a future variant lands in the final
    // arm. It maps to the *most* restrictive explanation rather than a
    // friendlier one: a refusal nobody has written a message for should not be
    // described as something milder than it is.
    match denied {
        Denied::NotDeclared => CommandError::new("capability-error-not-declared", detail),
        Denied::NotGranted => CommandError::new("capability-error-not-granted", detail),
        Denied::OutOfScope => CommandError::new("capability-error-out-of-scope", detail),
        _ => CommandError::new("capability-error-not-declared", detail),
    }
}

fn zotero_error(error: yaz_zotero::Error) -> CommandError {
    CommandError::new(error.message_key(), error)
}

/// How the library is currently being read, for the interface to display.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZoteroStatus {
    /// Stable identifier of the active source.
    source: String,
    /// Message key naming the source.
    source_key: String,
    /// Whether the source reflects the library as it is right now.
    is_live: bool,
    /// Whether citation keys come from a source that owns them.
    keys_are_authoritative: bool,
    /// The data directory in use, when reading offline.
    data_dir: Option<String>,
    /// Why no source is available, when none is.
    detail: Option<String>,
    /// What probing the live source found, whatever the outcome.
    ///
    /// Reported separately from `source` because "Zotero is running but its
    /// local API is switched off" is a thing the user can fix, and it is
    /// invisible if all they are told is that the library is being read offline.
    live_status_key: String,
    /// Whether a live source was tried and then demoted after failing.
    was_demoted: bool,
}

/// A library item as the picker shows it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZoteroItemDto {
    key: String,
    citation_key: Option<String>,
    item_type: String,
    title: String,
    creators: Vec<String>,
    year: Option<i32>,
    container: Option<String>,
}

/// A marked passage as the picker shows it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZoteroAnnotationDto {
    key: String,
    item_key: String,
    kind: String,
    /// Message key naming the kind.
    kind_key: String,
    text: String,
    comment: Option<String>,
    color: Option<String>,
    page_label: Option<String>,
    /// Whether this is text that can be quoted, as opposed to an ink or image
    /// mark, or the reader's own note.
    is_quotable: bool,
}

/// Which source is answering, and whether it is current.
#[tauri::command]
pub async fn plugin_zotero_status(
    plugin_id: String,
    host: tauri::State<'_, PluginHost>,
) -> Result<ZoteroStatus> {
    host.authorise(&plugin_id, &Request::Zotero).await?;
    let library = host.library().await?;
    let source = library.source();
    Ok(ZoteroStatus {
        source: source_id(source).to_owned(),
        source_key: source.status_key().to_owned(),
        is_live: source.is_live(),
        keys_are_authoritative: library.keys_are_authoritative(),
        data_dir: library.data_dir.as_ref().map(|d| d.path.to_string()),
        detail: library.failure.clone(),
        live_status_key: library.live_status.message_key().to_owned(),
        was_demoted: library.was_demoted(),
    })
}

fn source_id(source: ActiveSource) -> &'static str {
    match source {
        ActiveSource::BetterBibTeX => "better-bibtex",
        ActiveSource::LocalApi => "local-api",
        ActiveSource::ExportedBib => "exported-bib",
        ActiveSource::Sqlite => "sqlite",
        ActiveSource::None => "none",
    }
}

/// Search the library, or list recent items for an empty query.
#[tauri::command]
pub async fn plugin_zotero_search(
    plugin_id: String,
    query: String,
    limit: usize,
    host: tauri::State<'_, PluginHost>,
) -> Result<Vec<ZoteroItemDto>> {
    host.authorise(&plugin_id, &Request::Zotero).await?;
    let library = host.library().await?;
    // Bounded here rather than trusting the caller: an unbounded limit from the
    // webview would let a plugin pull an entire library across the IPC boundary
    // in one call.
    let limit = limit.clamp(1, 200);
    let items = library.search(&query, limit).await.map_err(zotero_error)?;

    Ok(items
        .into_iter()
        .map(|item| ZoteroItemDto {
            key: item.key,
            citation_key: item.citation_key,
            item_type: item.item_type,
            title: item.title,
            creators: item.creators,
            year: item.year,
            container: item.container,
        })
        .collect())
}

/// Every passage a reader marked in an item.
#[tauri::command]
pub async fn plugin_zotero_annotations(
    plugin_id: String,
    item_key: String,
    host: tauri::State<'_, PluginHost>,
) -> Result<Vec<ZoteroAnnotationDto>> {
    host.authorise(&plugin_id, &Request::Zotero).await?;
    let library = host.library().await?;
    let annotations = library.annotations(&item_key).await.map_err(zotero_error)?;

    Ok(annotations
        .into_iter()
        .map(|a| ZoteroAnnotationDto {
            is_quotable: a.has_quotable_text(),
            // Normalised here so the frontend never has to know that Zotero
            // writes `-` for an unpaginated attachment.
            page_label: a.meaningful_page_label().map(str::to_owned),
            kind: format!("{:?}", a.kind).to_lowercase(),
            kind_key: a.kind.label_key().to_owned(),
            key: a.key,
            item_key: a.item_key,
            text: a.text,
            comment: a.comment,
            color: a.color,
        })
        .collect())
}

/// The result of ensuring an item is citable from this project.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CitationKey {
    /// The key to use in `\cite{...}`.
    key: String,
    /// Whether the entry was appended to the bibliography by this call.
    added: bool,
    /// The bibliography file, relative to the project root.
    bibliography: String,
    /// Whether the key came from a source that owns citation keys.
    is_authoritative: bool,
}

/// Ensure an item exists in the project bibliography, and return its key.
///
/// [ADR-0008] makes the project `.bib` the compile-time source of truth, so this
/// copies the entry into the project rather than pointing at the library — a
/// document must build on a co-author's machine that has never had Zotero
/// installed.
///
/// The read-modify-write happens here rather than in the plugin because it is
/// one operation: a plugin doing it over three separate brokered calls could
/// interleave with itself and lose an entry.
///
/// [ADR-0008]: https://github.com/GeneralPawz/yaz/blob/main/docs/adr/0008-zotero-integration.md
#[tauri::command]
pub async fn plugin_zotero_ensure_in_bibliography(
    plugin_id: String,
    root: String,
    item_key: String,
    bibliography: Option<String>,
    host: tauri::State<'_, PluginHost>,
) -> Result<CitationKey> {
    host.ensure_in_bibliography(
        &plugin_id,
        &Utf8PathBuf::from(root),
        &item_key,
        bibliography,
    )
    .await
}

/// Re-probe the Zotero sources.
#[tauri::command]
pub async fn plugin_zotero_reconnect(
    plugin_id: String,
    host: tauri::State<'_, PluginHost>,
) -> Result<()> {
    host.authorise(&plugin_id, &Request::Zotero).await?;
    host.reconnect_zotero().await;
    Ok(())
}

/// Every bundled plugin, with the capabilities its manifest declares.
///
/// Note there is no command to *grant* capabilities. The frontend can ask what
/// is loaded; it cannot ask for more.
#[tauri::command]
pub async fn plugin_list(host: tauri::State<'_, PluginHost>) -> Result<Vec<CorePlugin>> {
    Ok(host.load_core_plugins().await)
}

/// Point the Zotero bridge at a specific data directory.
///
/// Discovery is right for almost everyone, but a machine can hold several Zotero
/// profiles pointing at different libraries — and choosing the wrong one does not
/// fail, it succeeds against an empty database and reports a library with no
/// items. This is the escape hatch for that, and passing `null` returns to
/// discovery.
#[tauri::command]
pub async fn plugin_set_zotero_data_dir(
    plugin_id: String,
    path: Option<String>,
    host: tauri::State<'_, PluginHost>,
) -> Result<ZoteroStatus> {
    host.authorise(&plugin_id, &Request::Zotero).await?;
    host.set_zotero_data_dir(path.map(Utf8PathBuf::from)).await;
    plugin_zotero_status(plugin_id, host).await
}

/// Rescope filesystem capabilities to the project the user just opened.
#[tauri::command]
pub async fn plugin_set_project(
    root: Option<String>,
    host: tauri::State<'_, PluginHost>,
) -> Result<()> {
    let root = root.map(Utf8PathBuf::from);
    host.set_project_root(root.as_deref()).await;
    Ok(())
}

/// What a plugin was refused, so the user can inspect it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DenialDto {
    plugin_id: String,
    capability: String,
    target: String,
    reason: String,
}

/// Every capability refusal recorded for a plugin.
///
/// Invariant 4 of the broker is that denials are recorded in a log the user can
/// inspect; this is how they reach the interface.
#[tauri::command]
pub async fn plugin_denials(
    plugin_id: String,
    host: tauri::State<'_, PluginHost>,
) -> Result<Vec<DenialDto>> {
    let broker = host.broker(&plugin_id).await?;
    Ok(broker
        .denials()
        .into_iter()
        .map(|d| DenialDto {
            plugin_id: d.plugin_id,
            capability: d.capability,
            target: d.target,
            reason: d.reason.reason().to_owned(),
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a Zotero library with one citable item, and point a host at it.
    ///
    /// This covers the whole path the picker drives — broker, library, BibTeX
    /// generation, the project's own `.bib`. Each piece is tested on its own
    /// elsewhere; what this checks is that they are wired to one another.
    async fn host_with_library(data_dir: &Utf8Path) -> PluginHost {
        let db = data_dir.join("zotero.sqlite");
        let connection = rusqlite::Connection::open(db.as_std_path()).unwrap();
        connection
            .execute_batch(
                r#"
        CREATE TABLE version (schema TEXT PRIMARY KEY, version INT NOT NULL);
        CREATE TABLE itemTypes (itemTypeID INTEGER PRIMARY KEY, typeName TEXT);
        CREATE TABLE items (itemID INTEGER PRIMARY KEY, itemTypeID INT, key TEXT, dateAdded TEXT);
        CREATE TABLE fields (fieldID INTEGER PRIMARY KEY, fieldName TEXT);
        CREATE TABLE itemDataValues (valueID INTEGER PRIMARY KEY, value TEXT);
        CREATE TABLE itemData (itemID INT, fieldID INT, valueID INT);
        CREATE TABLE creators (creatorID INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT, fieldMode INT);
        CREATE TABLE itemCreators (itemID INT, creatorID INT, creatorTypeID INT, orderIndex INT);
        CREATE TABLE itemAttachments (itemID INTEGER PRIMARY KEY, parentItemID INT, path TEXT);
        CREATE TABLE itemAnnotations (itemID INTEGER PRIMARY KEY, parentItemID INT, type INT,
            authorName TEXT, text TEXT, comment TEXT, color TEXT, pageLabel TEXT,
            sortIndex TEXT, position TEXT, isExternal INT);
        CREATE TABLE deletedItems (itemID INTEGER PRIMARY KEY, dateDeleted TEXT);
        INSERT INTO version VALUES ('userdata', 125);
        INSERT INTO itemTypes VALUES (1,'journalArticle');
        INSERT INTO items VALUES (10, 1, 'ITEMAAAA', '2024-01-02 10:00:00');
        INSERT INTO fields VALUES (1,'title'),(2,'date');
        INSERT INTO itemDataValues VALUES (100,'Cost & risk in 50% of BIM models'),(101,'2024-00-00 2024');
        INSERT INTO itemData VALUES (10,1,100),(10,2,101);
        INSERT INTO creators VALUES (200,'Anna','Müller',0);
        INSERT INTO itemCreators VALUES (10,200,1,0);
        "#,
            )
            .unwrap();

        let host = PluginHost::new();
        host.set_zotero_data_dir(Some(data_dir.to_path_buf())).await;
        host.load_core_plugins().await;
        host
    }

    /// A temporary library and project, as (library dir, project root).
    fn library_and_project() -> (
        tempfile::TempDir,
        tempfile::TempDir,
        Utf8PathBuf,
        Utf8PathBuf,
    ) {
        let library = tempfile::tempdir().unwrap();
        let project = tempfile::tempdir().unwrap();
        let library_dir = Utf8PathBuf::from_path_buf(library.path().to_path_buf()).unwrap();
        let project_root = Utf8PathBuf::from_path_buf(project.path().to_path_buf()).unwrap();
        (library, project, library_dir, project_root)
    }

    #[tokio::test]
    async fn citing_writes_a_usable_entry_into_the_project_bibliography() {
        let (_lib, _proj, library_dir, project_root) = library_and_project();
        let host = host_with_library(&library_dir).await;
        host.set_project_root(Some(&project_root)).await;

        let result = host
            .ensure_in_bibliography("com.yaz.zotero", &project_root, "ITEMAAAA", None)
            .await
            .expect("citing should succeed");

        assert!(result.added);
        assert_eq!(result.bibliography, "references.bib");
        // Umlauts transliterate rather than drop: `muller` is a different name.
        assert_eq!(result.key, "mueller2024cost");
        assert!(
            !result.is_authoritative,
            "no Better BibTeX, so the key is ours and must say so"
        );

        let bib = std::fs::read_to_string(project_root.join("references.bib").as_std_path())
            .expect("the .bib should exist");
        assert!(bib.starts_with("@article{mueller2024cost,"), "{bib}");
        // A raw `%` would comment out the rest of the line, breaking the build
        // while the entry still looked perfectly fine in the file.
        assert!(bib.contains(r"Cost \& risk in 50\% of BIM models"), "{bib}");
        assert!(bib.contains("author = {Müller, Anna}"), "{bib}");
    }

    #[tokio::test]
    async fn citing_the_same_source_twice_does_not_duplicate_the_entry() {
        let (_lib, _proj, library_dir, project_root) = library_and_project();
        let host = host_with_library(&library_dir).await;
        host.set_project_root(Some(&project_root)).await;

        let first = host
            .ensure_in_bibliography("com.yaz.zotero", &project_root, "ITEMAAAA", None)
            .await
            .unwrap();
        let second = host
            .ensure_in_bibliography("com.yaz.zotero", &project_root, "ITEMAAAA", None)
            .await
            .unwrap();

        assert!(first.added);
        assert!(!second.added, "the second call must not append");
        assert_eq!(first.key, second.key, "and must cite the same key");

        let bib =
            std::fs::read_to_string(project_root.join("references.bib").as_std_path()).unwrap();
        assert_eq!(bib.matches("@article{").count(), 1, "{bib}");
    }

    #[tokio::test]
    async fn a_citation_cannot_be_written_outside_the_open_project() {
        // fs:project is scoped to the project root, so a bibliography path that
        // escapes it must be refused by the broker rather than written.
        let (_lib, _proj, library_dir, project_root) = library_and_project();
        let host = host_with_library(&library_dir).await;
        host.set_project_root(Some(&project_root)).await;

        let error = host
            .ensure_in_bibliography(
                "com.yaz.zotero",
                &project_root,
                "ITEMAAAA",
                Some("../../escaped.bib".to_owned()),
            )
            .await
            .unwrap_err();
        assert_eq!(error.message_key(), "capability-error-out-of-scope");
    }

    #[tokio::test]
    async fn an_item_that_is_no_longer_in_the_library_is_reported() {
        let (_lib, _proj, library_dir, project_root) = library_and_project();
        let host = host_with_library(&library_dir).await;
        host.set_project_root(Some(&project_root)).await;

        let error = host
            .ensure_in_bibliography("com.yaz.zotero", &project_root, "GONEGONE", None)
            .await
            .unwrap_err();
        assert_eq!(error.message_key(), "zotero-error-item-not-found");
    }

    #[tokio::test]
    async fn the_bundled_manifests_parse_and_grant_what_they_declare() {
        // A bundled manifest that does not parse is a build error in disguise:
        // the plugin would simply never be granted anything, and the feature
        // would fail at runtime with a capability refusal.
        let host = PluginHost::new();
        let loaded = host.load_core_plugins().await;

        assert!(!loaded.is_empty(), "no core plugin manifest parsed");
        let zotero = loaded
            .iter()
            .find(|p| p.id == "com.yaz.zotero")
            .expect("the Zotero core plugin should be bundled");
        assert!(zotero.capabilities.contains(&"zotero".to_owned()));
        assert!(zotero.capabilities.contains(&"fs:project".to_owned()));

        // And the grant must actually reach the broker.
        assert!(
            host.authorise("com.yaz.zotero", &Request::Zotero)
                .await
                .is_ok()
        );
    }

    #[tokio::test]
    async fn a_core_plugin_gets_no_capability_it_did_not_declare() {
        let host = PluginHost::new();
        host.load_core_plugins().await;

        // The Zotero manifest declares zotero and fs:project. Nothing else.
        for request in [Request::Obsidian, Request::Clipboard, Request::ShellOpen] {
            let error = host
                .authorise("com.yaz.zotero", &request)
                .await
                .unwrap_err();
            assert_eq!(error.message_key(), "capability-error-not-declared");
        }
        let error = host
            .authorise(
                "com.yaz.zotero",
                &Request::Net {
                    host: "evil.example",
                },
            )
            .await
            .unwrap_err();
        assert_eq!(error.message_key(), "capability-error-not-declared");
    }

    #[tokio::test]
    async fn an_unloaded_plugin_is_refused() {
        let host = PluginHost::new();
        let error = host
            .authorise("com.example.ghost", &Request::Zotero)
            .await
            .unwrap_err();
        assert_eq!(error.message_key(), "plugin-error-not-loaded");
    }

    #[tokio::test]
    async fn a_loaded_plugin_only_gets_what_it_was_granted() {
        let host = PluginHost::new();
        host.load("com.yaz.zotero", vec![Capability::Zotero]).await;

        assert!(
            host.authorise("com.yaz.zotero", &Request::Zotero)
                .await
                .is_ok()
        );

        let error = host
            .authorise("com.yaz.zotero", &Request::Obsidian)
            .await
            .unwrap_err();
        assert_eq!(error.message_key(), "capability-error-not-declared");
    }

    #[tokio::test]
    async fn holding_zotero_does_not_imply_writing_to_disk() {
        // The reason the bibliography command authorises the write separately.
        let dir = tempfile::tempdir().unwrap();
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();

        let host = PluginHost::new();
        host.set_project_root(Some(&root)).await;
        host.load("com.yaz.zotero", vec![Capability::Zotero]).await;

        // An absolute path inside the open project, so the refusal is about the
        // capability rather than about the path being unresolvable.
        let error = host
            .authorise(
                "com.yaz.zotero",
                &Request::FsWrite(&root.join("references.bib")),
            )
            .await
            .unwrap_err();
        assert_eq!(error.message_key(), "capability-error-not-declared");
    }

    #[tokio::test]
    async fn a_relative_path_is_refused_because_it_cannot_be_resolved() {
        // Invariant 3: a path the broker cannot reason about is denied. A bare
        // relative path has no base, so there is no containment question to
        // answer — and answering it optimistically would be the bug.
        let host = PluginHost::new();
        host.load("p", vec![Capability::FsProject]).await;

        let relative = Utf8PathBuf::from("references.bib");
        let error = host
            .authorise("p", &Request::FsWrite(&relative))
            .await
            .unwrap_err();
        assert_eq!(error.message_key(), "capability-error-out-of-scope");
    }

    #[tokio::test]
    async fn changing_project_rescopes_the_filesystem_capability() {
        let first = tempfile::tempdir().unwrap();
        let second = tempfile::tempdir().unwrap();
        let first_root = Utf8PathBuf::from_path_buf(first.path().to_path_buf()).unwrap();
        let second_root = Utf8PathBuf::from_path_buf(second.path().to_path_buf()).unwrap();

        let host = PluginHost::new();
        host.set_project_root(Some(&first_root)).await;
        host.load("p", vec![Capability::FsProject]).await;

        let target = first_root.join("a.bib");
        assert!(
            host.authorise("p", &Request::FsWrite(&target))
                .await
                .is_ok()
        );

        // Opening another project must revoke access to the previous one, or a
        // plugin keeps writing into a project the user has closed.
        host.set_project_root(Some(&second_root)).await;
        let error = host
            .authorise("p", &Request::FsWrite(&target))
            .await
            .unwrap_err();
        assert_eq!(error.message_key(), "capability-error-out-of-scope");

        assert!(
            host.authorise("p", &Request::FsWrite(&second_root.join("a.bib")))
                .await
                .is_ok()
        );
    }
}
