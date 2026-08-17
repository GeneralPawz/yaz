//! The offline source: Zotero's own database, read from a copy.
//!
//! # Never in place
//!
//! Zotero holds an exclusive lock on `zotero.sqlite` while it runs, and opening
//! a user's live library read-write would risk the one thing this crate must
//! never do — damage a library it does not own. So the file is copied and the
//! copy is opened read-only, exactly as [ADR-0008] requires.
//!
//! The database uses `journal_mode = delete` rather than WAL, so the main file
//! is self-contained and a plain copy is consistent. That is checked in
//! [`SqliteSource::open`] rather than assumed, because a future Zotero that
//! switched to WAL would make a copy of just the main file silently stale — it
//! would still open, still answer queries, and quietly omit recent work.
//!
//! # The schema is not ours
//!
//! It belongs to Zotero and changes between releases. [ADR-0008] decided that an
//! unrecognised version disables this source and says so, rather than
//! mis-parsing somebody's library, so [`SUPPORTED_USERDATA`] is a deliberate
//! ceiling that must be raised by a human who has checked the new schema.
//!
//! [ADR-0008]: https://github.com/GeneralPawz/yaz/blob/main/docs/adr/0008-zotero-integration.md

use camino::{Utf8Path, Utf8PathBuf};
use rusqlite::{Connection, OpenFlags};

use crate::error::{Error, Result};
use crate::model::{Annotation, AnnotationKind, Item};

/// The `userdata` schema versions this module has been checked against.
///
/// The floor is Zotero 7, which is where `itemAnnotations` takes its current
/// shape. The ceiling is headroom, not knowledge: raise it only after reading
/// the migration that bumped the version.
pub const SUPPORTED_USERDATA: std::ops::RangeInclusive<i64> = 120..=140;

/// Item types that are not independently citable.
///
/// Zotero keeps attachments, notes and annotations in the same `items` table as
/// bibliographic records. Offering a PDF attachment as a citation target would
/// produce a citation to a file rather than to a work.
const NON_CITABLE: [&str; 3] = ["attachment", "note", "annotation"];

/// A read-only view of a Zotero library.
#[derive(Debug)]
pub struct SqliteSource {
    connection: Connection,
    /// The cached copy this reads from.
    ///
    /// Kept rather than deleted on drop: it is a cache keyed to the source
    /// library, reused across launches, and refreshed only when Zotero writes.
    pub cache_path: Utf8PathBuf,
    /// The `userdata` schema version this library reported.
    pub schema_version: i64,
}

impl SqliteSource {
    /// Copy the library and open the copy read-only.
    ///
    /// `scratch` is the directory the cached copy lives in.
    ///
    /// # The copy is a cache, not a temporary
    ///
    /// The first version used a fresh filename per open and deleted it on
    /// `Drop`. `Drop` does not run when a process is killed, and a desktop
    /// application is killed all the time — so the copies accumulated. On the
    /// machine this was found on: **201 files, a gigabyte**, one per launch and
    /// one per test run, growing without bound.
    ///
    /// So there is now one copy per library, named deterministically from the
    /// source path, refreshed only when the source has actually changed. That
    /// fixes the leak and removes a 146 MB copy from the common path — Zotero
    /// only writes when the user edits their library, and most launches reuse.
    pub fn open(database: &Utf8Path, scratch: &Utf8Path) -> Result<Self> {
        let source_meta =
            std::fs::metadata(database.as_std_path()).map_err(|_| Error::NoLibrary {
                path: database.to_owned(),
            })?;
        if !source_meta.is_file() {
            return Err(Error::NoLibrary {
                path: database.to_owned(),
            });
        }

        std::fs::create_dir_all(scratch.as_std_path()).map_err(|source| Error::Io {
            path: scratch.to_owned(),
            source,
        })?;

        let copy = scratch.join(cache_name(database));
        sweep_leaked_copies(scratch, &copy);

        if !copy_is_current(&copy, &source_meta) {
            match std::fs::copy(database.as_std_path(), copy.as_std_path()) {
                Ok(_) => {}
                // Another yaz is reading this exact copy, so it cannot be
                // replaced. Using the slightly older copy beats failing: it is
                // a library view, and the alternative is no library at all.
                Err(error) if copy.as_std_path().is_file() => {
                    tracing::warn!(%error, "could not refresh the library copy; using the existing one");
                }
                Err(source) => {
                    return Err(Error::Io {
                        path: database.to_owned(),
                        source,
                    });
                }
            }
        }

        let connection = Connection::open_with_flags(
            copy.as_std_path(),
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI,
        )
        .map_err(|source| Error::Database {
            source: Box::new(source),
        })?;

        let journal_mode: String = connection
            .query_row("PRAGMA journal_mode", [], |row| row.get(0))
            .map_err(|source| Error::Database {
                source: Box::new(source),
            })?;
        if !journal_mode.eq_ignore_ascii_case("delete")
            && !journal_mode.eq_ignore_ascii_case("truncate")
            && !journal_mode.eq_ignore_ascii_case("persist")
            && !journal_mode.eq_ignore_ascii_case("memory")
            && !journal_mode.eq_ignore_ascii_case("off")
        {
            // WAL means recent transactions live in a sidecar file we did not
            // copy. Reading on regardless would answer from a stale snapshot
            // while looking entirely healthy.
            return Err(Error::UnsupportedJournalMode { mode: journal_mode });
        }

        let schema_version: i64 = connection
            .query_row(
                "SELECT version FROM version WHERE schema = 'userdata'",
                [],
                |row| row.get(0),
            )
            .map_err(|source| Error::Database {
                source: Box::new(source),
            })?;

        if !SUPPORTED_USERDATA.contains(&schema_version) {
            return Err(Error::UnsupportedSchema {
                found: schema_version,
                supported_from: *SUPPORTED_USERDATA.start(),
                supported_to: *SUPPORTED_USERDATA.end(),
            });
        }

        Ok(Self {
            connection,
            cache_path: copy,
            schema_version,
        })
    }

    /// Search titles and creator surnames.
    ///
    /// Two passes on purpose. Selecting candidate ids first and hydrating only
    /// those keeps the expensive per-item field lookups proportional to `limit`
    /// rather than to the size of the library — which on a real library is the
    /// difference between a responsive picker and a frozen one.
    pub fn search(&self, query: &str, limit: usize) -> Result<Vec<Item>> {
        let pattern = format!("%{}%", escape_like(query));
        let ids = self.candidate_ids(&pattern, limit)?;
        ids.into_iter().map(|id| self.hydrate(id)).collect()
    }

    /// The most recently added items, for an empty query.
    ///
    /// A picker that shows nothing until you type gives no sense of whether the
    /// library was found at all.
    pub fn recent(&self, limit: usize) -> Result<Vec<Item>> {
        let mut statement = self
            .connection
            .prepare(
                "SELECT i.itemID FROM items i
                 JOIN itemTypes it ON it.itemTypeID = i.itemTypeID
                 WHERE i.itemID NOT IN (SELECT itemID FROM deletedItems)
                   AND it.typeName NOT IN (?1, ?2, ?3)
                 ORDER BY i.dateAdded DESC
                 LIMIT ?4",
            )
            .map_err(database)?;
        let ids = statement
            .query_map(
                rusqlite::params![NON_CITABLE[0], NON_CITABLE[1], NON_CITABLE[2], limit as i64],
                |row| row.get::<_, i64>(0),
            )
            .map_err(database)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(database)?;
        ids.into_iter().map(|id| self.hydrate(id)).collect()
    }

    /// Look one item up by its Zotero key.
    ///
    /// Distinct from [`SqliteSource::search`] on purpose. Search matches titles
    /// and creator surnames, so passing a key to it matches nothing — an item
    /// key appears in no field a reader would ever search. Citing an item is a
    /// lookup, not a search, and conflating the two fails for every item.
    pub fn find(&self, item_key: &str) -> Result<Option<Item>> {
        let id: Option<i64> = self
            .connection
            .query_row(
                "SELECT i.itemID FROM items i
                 JOIN itemTypes it ON it.itemTypeID = i.itemTypeID
                 WHERE i.key = ?1
                   AND i.itemID NOT IN (SELECT itemID FROM deletedItems)
                   AND it.typeName NOT IN (?2, ?3, ?4)",
                rusqlite::params![item_key, NON_CITABLE[0], NON_CITABLE[1], NON_CITABLE[2]],
                |row| row.get(0),
            )
            .map(Some)
            .or_else(|error| match error {
                rusqlite::Error::QueryReturnedNoRows => Ok(None),
                other => Err(database(other)),
            })?;

        id.map(|id| self.hydrate(id)).transpose()
    }

    fn candidate_ids(&self, pattern: &str, limit: usize) -> Result<Vec<i64>> {
        let mut statement = self
            .connection
            .prepare(
                "SELECT i.itemID FROM items i
                 JOIN itemTypes it ON it.itemTypeID = i.itemTypeID
                 WHERE i.itemID NOT IN (SELECT itemID FROM deletedItems)
                   AND it.typeName NOT IN (?2, ?3, ?4)
                   AND (
                     EXISTS (
                       SELECT 1 FROM itemData d
                       JOIN itemDataValues v ON v.valueID = d.valueID
                       JOIN fields f ON f.fieldID = d.fieldID
                       WHERE d.itemID = i.itemID
                         AND f.fieldName IN ('title', 'shortTitle', 'publicationTitle')
                         AND v.value LIKE ?1 ESCAPE '\\'
                     )
                     OR EXISTS (
                       SELECT 1 FROM itemCreators ic
                       JOIN creators c ON c.creatorID = ic.creatorID
                       WHERE ic.itemID = i.itemID AND c.lastName LIKE ?1 ESCAPE '\\'
                     )
                   )
                 ORDER BY i.dateAdded DESC
                 LIMIT ?5",
            )
            .map_err(database)?;

        let ids = statement
            .query_map(
                rusqlite::params![
                    pattern,
                    NON_CITABLE[0],
                    NON_CITABLE[1],
                    NON_CITABLE[2],
                    limit as i64
                ],
                |row| row.get::<_, i64>(0),
            )
            .map_err(database)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(database)?;
        Ok(ids)
    }

    /// Build a full [`Item`] from an internal row id.
    fn hydrate(&self, item_id: i64) -> Result<Item> {
        let (key, item_type): (String, String) = self
            .connection
            .query_row(
                "SELECT i.key, it.typeName FROM items i
                 JOIN itemTypes it ON it.itemTypeID = i.itemTypeID
                 WHERE i.itemID = ?1",
                [item_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(database)?;

        let field = |name: &str| -> Result<Option<String>> {
            self.connection
                .query_row(
                    "SELECT v.value FROM itemData d
                     JOIN itemDataValues v ON v.valueID = d.valueID
                     JOIN fields f ON f.fieldID = d.fieldID
                     WHERE d.itemID = ?1 AND f.fieldName = ?2",
                    rusqlite::params![item_id, name],
                    |row| row.get::<_, String>(0),
                )
                .map(Some)
                .or_else(|error| match error {
                    rusqlite::Error::QueryReturnedNoRows => Ok(None),
                    other => Err(database(other)),
                })
        };

        let mut creators_statement = self
            .connection
            .prepare(
                "SELECT c.firstName, c.lastName, c.fieldMode FROM itemCreators ic
                 JOIN creators c ON c.creatorID = ic.creatorID
                 WHERE ic.itemID = ?1
                 ORDER BY ic.orderIndex",
            )
            .map_err(database)?;
        let creators = creators_statement
            .query_map([item_id], |row| {
                let first: Option<String> = row.get(0)?;
                let last: Option<String> = row.get(1)?;
                // fieldMode 1 means the name is a single institutional field
                // held in lastName — "European Commission", not a person.
                let mode: i64 = row.get(2).unwrap_or(0);
                Ok(format_creator(first.as_deref(), last.as_deref(), mode))
            })
            .map_err(database)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(database)?;

        Ok(Item {
            key,
            citation_key: None,
            item_type,
            title: field("title")?.unwrap_or_default(),
            creators: creators.into_iter().flatten().collect(),
            year: field("date")?.as_deref().and_then(parse_year),
            container: field("publicationTitle")?,
            doi: field("DOI")?,
        })
    }

    /// Every marked passage belonging to an item.
    ///
    /// Zotero anchors annotations to an attachment, not to the item, so this
    /// walks annotation → attachment → item. Trashed annotations are excluded:
    /// a reader who deleted a highlight should not be offered it.
    pub fn annotations(&self, item_key: &str) -> Result<Vec<Annotation>> {
        let mut statement = self
            .connection
            .prepare(
                "SELECT ann.key, a.type, a.text, a.comment, a.color, a.pageLabel
                 FROM itemAnnotations a
                 JOIN items ann ON ann.itemID = a.itemID
                 JOIN itemAttachments att ON att.itemID = a.parentItemID
                 JOIN items parent ON parent.itemID = att.parentItemID
                 WHERE parent.key = ?1
                   AND a.itemID NOT IN (SELECT itemID FROM deletedItems)
                 ORDER BY a.sortIndex",
            )
            .map_err(database)?;

        let rows = statement
            .query_map([item_key], |row| {
                let kind_code: i64 = row.get(1)?;
                Ok(Annotation {
                    key: row.get(0)?,
                    item_key: item_key.to_owned(),
                    kind: annotation_kind(kind_code),
                    text: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                    comment: row
                        .get::<_, Option<String>>(3)?
                        .filter(|c| !c.trim().is_empty()),
                    color: row.get(4)?,
                    page_label: row.get(5)?,
                })
            })
            .map_err(database)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(database)?;
        Ok(rows)
    }
}

/// Prefix every cached copy shares, so leaked ones can be recognised.
const CACHE_PREFIX: &str = "yaz-zotero-";

/// A deterministic filename for this library's cached copy.
///
/// Derived from the source path so that two different libraries — a machine can
/// easily have two Zotero profiles — do not share, and so that the same library
/// reuses its copy across launches.
fn cache_name(database: &Utf8Path) -> String {
    format!(
        "{CACHE_PREFIX}cache-{:016x}.sqlite",
        fnv1a(database.as_str())
    )
}

/// FNV-1a, written out rather than using `DefaultHasher`.
///
/// `DefaultHasher`'s output is explicitly not stable across Rust releases, and a
/// cache filename that changes when the toolchain does would silently orphan the
/// previous copy — which is the bug this whole mechanism exists to fix.
fn fnv1a(input: &str) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in input.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

/// Whether the cached copy still reflects the source.
///
/// Size and modification time together. Zotero rewrites the file whenever the
/// user changes their library, so the timestamp moves; comparing size as well
/// catches a restore-from-backup that happens to preserve the timestamp.
fn copy_is_current(copy: &Utf8Path, source: &std::fs::Metadata) -> bool {
    let Ok(existing) = std::fs::metadata(copy.as_std_path()) else {
        return false;
    };
    if existing.len() != source.len() {
        return false;
    }
    match (existing.modified(), source.modified()) {
        (Ok(copied), Ok(original)) => copied >= original,
        // Without timestamps there is no way to tell; re-copying is the safe
        // answer, since a stale library is a wrong one.
        _ => false,
    }
}

/// Remove copies left behind by the old per-open naming scheme.
///
/// Only those. A `cache-` file that is not ours belongs to a *different*
/// library — a machine can easily have two Zotero profiles — and deleting it
/// would make the two libraries take turns re-copying each other's cache.
///
/// Best effort throughout: a file that cannot be removed is in use by another
/// process, which is exactly the file to leave alone.
fn sweep_leaked_copies(scratch: &Utf8Path, keep: &Utf8Path) {
    let cache_marker = format!("{CACHE_PREFIX}cache-");
    let Ok(entries) = std::fs::read_dir(scratch.as_std_path()) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path == keep.as_std_path() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let leaked = name.starts_with(CACHE_PREFIX)
            && !name.starts_with(&cache_marker)
            && name.ends_with(".sqlite");
        if leaked {
            let _ = std::fs::remove_file(&path);
        }
    }
}

fn database(source: rusqlite::Error) -> Error {
    Error::Database {
        source: Box::new(source),
    }
}

/// Map Zotero's annotation type codes.
///
/// Unknown codes become [`AnnotationKind::Other`] rather than an error: Zotero
/// adds types over time, and a library containing a newer one is not corrupt.
fn annotation_kind(code: i64) -> AnnotationKind {
    match code {
        1 => AnnotationKind::Highlight,
        2 => AnnotationKind::Note,
        3 => AnnotationKind::Image,
        4 => AnnotationKind::Ink,
        5 => AnnotationKind::Underline,
        _ => AnnotationKind::Other,
    }
}

/// Format a creator for display, or `None` if the row holds no name at all.
fn format_creator(first: Option<&str>, last: Option<&str>, field_mode: i64) -> Option<String> {
    let first = first.map(str::trim).filter(|s| !s.is_empty());
    let last = last.map(str::trim).filter(|s| !s.is_empty());
    if field_mode == 1 {
        return last.map(str::to_owned);
    }
    match (first, last) {
        (Some(first), Some(last)) => Some(format!("{last}, {first}")),
        (None, Some(last)) => Some(last.to_owned()),
        (Some(first), None) => Some(first.to_owned()),
        (None, None) => None,
    }
}

/// Pull a year out of Zotero's date field.
///
/// Zotero stores dates as its own multipart value: an ISO-ish prefix followed by
/// whatever the user or importer originally wrote, e.g. `2024-10-19 2024-10-19`
/// or `2024-00-00 2024`. Zero components mean "unknown", not January. Only the
/// leading year is reliable, so only the leading year is taken.
fn parse_year(date: &str) -> Option<i32> {
    let head: String = date
        .trim()
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect();
    if head.len() != 4 {
        return None;
    }
    head.parse().ok()
}

/// Escape the wildcards SQL `LIKE` would otherwise interpret.
///
/// Without this, searching for `100%` matches everything, and a stray `_`
/// silently becomes "any character".
fn escape_like(query: &str) -> String {
    query
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn annotation_codes_map_to_kinds() {
        assert_eq!(annotation_kind(1), AnnotationKind::Highlight);
        assert_eq!(annotation_kind(5), AnnotationKind::Underline);
        // Type 6 exists in a real library and is not one this version names.
        assert_eq!(annotation_kind(6), AnnotationKind::Other);
        assert_eq!(annotation_kind(999), AnnotationKind::Other);
    }

    #[test]
    fn year_comes_from_zoteros_multipart_date() {
        // Both shapes occur in a real library.
        assert_eq!(parse_year("2024-10-19 2024-10-19"), Some(2024));
        assert_eq!(parse_year("2024-00-00 2024"), Some(2024));
        assert_eq!(parse_year("1998-05-00 05/1998"), Some(1998));
    }

    #[test]
    fn undated_and_malformed_dates_yield_no_year() {
        assert_eq!(parse_year(""), None);
        assert_eq!(parse_year("n.d."), None);
        assert_eq!(parse_year("in press"), None);
        // A two-digit year is ambiguous; refusing beats guessing a century.
        assert_eq!(parse_year("98-05-00 05/98"), None);
    }

    #[test]
    fn like_wildcards_in_a_query_are_escaped() {
        // Searching for a literal "100%" must not match every item.
        assert_eq!(escape_like("100%"), "100\\%");
        assert_eq!(escape_like("a_b"), "a\\_b");
        assert_eq!(escape_like("back\\slash"), "back\\\\slash");
        assert_eq!(escape_like("plain"), "plain");
    }

    #[test]
    fn institutional_creators_keep_their_single_name() {
        // fieldMode 1 is Zotero's "this is one institutional name" flag.
        assert_eq!(
            format_creator(None, Some("European Commission"), 1),
            Some("European Commission".to_owned())
        );
        assert_eq!(
            format_creator(Some("Ada"), Some("Lovelace"), 0),
            Some("Lovelace, Ada".to_owned())
        );
        assert_eq!(
            format_creator(None, Some("Hagedorn"), 0),
            Some("Hagedorn".to_owned())
        );
        assert_eq!(format_creator(None, None, 0), None);
        assert_eq!(format_creator(Some("  "), Some("  "), 0), None);
    }
}
