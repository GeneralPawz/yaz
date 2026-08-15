//! One interface over the available sources.
//!
//! [ADR-0008] specifies four sources in priority order, degrading rather than
//! failing, and **always reporting which one is live**. That last part is the
//! design: silently answering from a stale export while looking like a live
//! library is a correctness problem in a citation tool, not a graceful
//! fallback, so [`Library::source`] is not optional detail.
//!
//! # Degrading is a runtime behaviour, not a startup one
//!
//! The first version of this picked a source when it connected and then used it
//! for the rest of the session. That is not degradation — it is a choice made
//! once, and if the chosen source later refuses, every query fails. Which is
//! what happened: Zotero's local API is disabled by default, the probe was
//! asking `/connector/ping` (which answers `200` whenever Zotero is running at
//! all), so the live source was selected and then returned `403` to everything.
//! The picker showed "could not load the list" on a machine with an eleven
//! thousand item library sitting right there on disk.
//!
//! So both sources are opened when both are possible, and a live failure falls
//! through to the offline one *at query time*, once, with the demotion recorded
//! so the interface stops claiming to be live.
//!
//! # What is implemented
//!
//! | Tier | Source | State |
//! |---|---|---|
//! | 1 | Better BibTeX JSON-RPC | not yet |
//! | 2 | Zotero 7 local API | implemented; needs the local API enabled in Zotero |
//! | 3 | Watched exported `.bib` | not yet |
//! | 4 | `zotero.sqlite` copy | implemented and verified against a real library |
//!
//! [ADR-0008]: https://github.com/GeneralPawz/yaz/blob/main/docs/adr/0008-zotero-integration.md

use camino::Utf8PathBuf;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

use crate::ActiveSource;
use crate::datadir::{self, DataDir};
use crate::error::{Error, Result};
use crate::local_api::{Availability, LocalApi};
use crate::model::{Annotation, Item};
use crate::sqlite::SqliteSource;

/// How to find the library.
#[derive(Debug, Clone, Default)]
pub struct Config {
    /// An explicit data directory, overriding discovery.
    pub data_dir: Option<Utf8PathBuf>,
    /// Directory for the read-only database copy.
    pub scratch: Utf8PathBuf,
}

/// A connected Zotero library.
pub struct Library {
    /// The live source, when one answered the probe.
    live: Option<LocalApi>,
    /// Set once a live query has failed, so the interface stops claiming live.
    demoted: AtomicBool,
    /// `Mutex` because `rusqlite::Connection` is `Send` but not `Sync`, and this
    /// is held in shared application state. The lock is never held across an
    /// `await`; every sqlite call completes synchronously inside its own scope.
    offline: Option<Mutex<SqliteSource>>,
    /// Where the offline library was found, for the interface to explain.
    pub data_dir: Option<DataDir>,
    /// What the live probe found, whatever the outcome.
    pub live_status: Availability,
    /// Why no source could be reached, when none could.
    pub failure: Option<String>,
}

impl std::fmt::Debug for Library {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Library")
            .field("source", &self.source())
            .field("live_status", &self.live_status)
            .field("data_dir", &self.data_dir)
            .finish_non_exhaustive()
    }
}

impl Library {
    /// Probe the sources and open every one that is available.
    ///
    /// Never fails. "No source available" is a state the interface must show
    /// anyway — a user without Zotero installed is not an error condition — so
    /// it is represented as [`ActiveSource::None`] rather than an `Err`.
    pub async fn connect(config: &Config, http: reqwest::Client) -> Self {
        let api = LocalApi::new(http);
        let live_status = api.availability().await;
        let live = matches!(live_status, Availability::Available).then_some(api);

        // Opened even when the live source works, so a later live failure has
        // somewhere to fall through to. Copying the database while Zotero holds
        // it open is fine — that is the whole reason for copying.
        let (offline, data_dir, failure) = match datadir::resolve(config.data_dir.as_deref()) {
            None => (
                None,
                None,
                Some("no Zotero data directory could be located".to_owned()),
            ),
            Some(dir) => match SqliteSource::open(&dir.database(), &config.scratch) {
                Ok(source) => (Some(Mutex::new(source)), Some(dir), None),
                Err(error) => (None, Some(dir), Some(error.to_string())),
            },
        };

        // Only a genuine failure when nothing at all can answer: a missing
        // offline library is unremarkable while the live source works.
        let failure = failure.filter(|_| live.is_none());

        Self {
            live,
            demoted: AtomicBool::new(false),
            offline,
            data_dir,
            live_status,
            failure,
        }
    }

    /// Which source is answering right now.
    pub fn source(&self) -> ActiveSource {
        if self.live.is_some() && !self.demoted.load(Ordering::Relaxed) {
            return ActiveSource::LocalApi;
        }
        if self.offline.is_some() {
            return ActiveSource::Sqlite;
        }
        ActiveSource::None
    }

    /// Whether a live source was demoted after failing a query.
    pub fn was_demoted(&self) -> bool {
        self.demoted.load(Ordering::Relaxed)
    }

    /// Whether citation keys come from a source that owns them.
    ///
    /// `false` means keys are generated here and may not match what a
    /// collaborator's Better BibTeX produces. [ADR-0008] requires that this is
    /// flagged rather than assumed away.
    ///
    /// [ADR-0008]: https://github.com/GeneralPawz/yaz/blob/main/docs/adr/0008-zotero-integration.md
    pub fn keys_are_authoritative(&self) -> bool {
        matches!(self.source(), ActiveSource::BetterBibTeX)
    }

    /// Record that the live source failed, so it is not tried again.
    ///
    /// Once rather than per call: a source returning `403` to one query will
    /// return it to the next, and retrying on every keystroke would make the
    /// picker feel broken while producing the same answer.
    fn demote(&self, error: &Error) {
        if !self.demoted.swap(true, Ordering::Relaxed) {
            tracing::warn!(%error, "the live Zotero source failed; falling back to the offline library");
        }
    }

    fn offline_source(&self) -> Result<&Mutex<SqliteSource>> {
        self.offline.as_ref().ok_or(Error::NotRunning)
    }

    /// Search the library, or list recent items when the query is empty.
    pub async fn search(&self, query: &str, limit: usize) -> Result<Vec<Item>> {
        if let Some(api) = self.live_if_trusted() {
            match api.search(query, limit).await {
                Ok(items) => return Ok(items),
                Err(error) => self.demote(&error),
            }
        }
        // Scoped so the guard is dropped before returning, and so no `await`
        // can ever be introduced while it is held.
        let source = self
            .offline_source()?
            .lock()
            .expect("zotero library mutex poisoned");
        if query.trim().is_empty() {
            source.recent(limit)
        } else {
            source.search(query, limit)
        }
    }

    /// Look one item up by its Zotero key.
    ///
    /// Not a one-result search. An item key matches no field a reader would ever
    /// search on, so routing a lookup through [`Library::search`] finds nothing —
    /// for every item, not just some.
    pub async fn find(&self, item_key: &str) -> Result<Option<Item>> {
        if let Some(api) = self.live_if_trusted() {
            match api.find(item_key).await {
                Ok(item) => return Ok(item),
                Err(error) => self.demote(&error),
            }
        }
        let source = self
            .offline_source()?
            .lock()
            .expect("zotero library mutex poisoned");
        source.find(item_key)
    }

    /// Every marked passage on an item.
    pub async fn annotations(&self, item_key: &str) -> Result<Vec<Annotation>> {
        if let Some(api) = self.live_if_trusted() {
            match api.annotations(item_key).await {
                Ok(annotations) => return Ok(annotations),
                Err(error) => self.demote(&error),
            }
        }
        let source = self
            .offline_source()?
            .lock()
            .expect("zotero library mutex poisoned");
        source.annotations(item_key)
    }

    /// The live source, unless it has already failed.
    fn live_if_trusted(&self) -> Option<&LocalApi> {
        if self.demoted.load(Ordering::Relaxed) {
            return None;
        }
        self.live.as_ref()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn library(live: bool, offline: bool) -> Library {
        Library {
            live: live.then(|| LocalApi::new(reqwest::Client::new())),
            demoted: AtomicBool::new(false),
            // A real SqliteSource needs a database; these cases only exercise
            // which source `source()` reports, so presence is what matters.
            offline: None,
            data_dir: None,
            live_status: if live {
                Availability::Available
            } else {
                Availability::NotRunning
            },
            failure: (!live && !offline).then(|| "nothing".to_owned()),
        }
    }

    #[test]
    fn a_demoted_live_source_stops_being_reported_as_live() {
        let library = library(true, false);
        assert_eq!(library.source(), ActiveSource::LocalApi);
        assert!(library.source().is_live());

        library.demoted.store(true, Ordering::Relaxed);
        // With no offline source there is nothing left, and it must not go on
        // claiming a live connection it has already given up on.
        assert_eq!(library.source(), ActiveSource::None);
        assert!(!library.source().is_live());
        assert!(library.was_demoted());
    }

    #[test]
    fn demotion_is_recorded_once() {
        let library = library(true, false);
        library.demote(&Error::NotRunning);
        assert!(library.was_demoted());
        // Idempotent: a second failure must not reset anything.
        library.demote(&Error::NotRunning);
        assert!(library.was_demoted());
    }

    #[test]
    fn the_live_source_is_not_consulted_once_demoted() {
        let library = library(true, false);
        assert!(library.live_if_trusted().is_some());
        library.demoted.store(true, Ordering::Relaxed);
        assert!(
            library.live_if_trusted().is_none(),
            "a source that answered 403 once will answer 403 again; retrying on \
             every keystroke would make the picker feel broken"
        );
    }

    #[test]
    fn no_source_is_a_state_rather_than_an_error() {
        let library = library(false, false);
        assert_eq!(library.source(), ActiveSource::None);
        assert!(!library.source().is_live());
        assert!(library.failure.is_some(), "the reason must be reportable");
    }

    #[test]
    fn only_better_bibtex_owns_citation_keys() {
        // The local-API and sqlite tiers make us generate keys, and the user has
        // to be told, because a generated key can disagree with a co-author's.
        assert!(!library(true, false).keys_are_authoritative());
        assert!(!library(false, false).keys_are_authoritative());
    }

    #[test]
    fn liveness_matches_the_adr_table() {
        assert!(ActiveSource::BetterBibTeX.is_live());
        assert!(ActiveSource::LocalApi.is_live());
        // An export is as current as the last export, which is not live.
        assert!(!ActiveSource::ExportedBib.is_live());
        assert!(!ActiveSource::Sqlite.is_live());
        assert!(!ActiveSource::None.is_live());
    }

    #[test]
    fn a_disabled_local_api_is_distinguished_from_a_closed_zotero() {
        // These need different words: one is the ordinary state, the other is a
        // setting the user can change in half a minute.
        assert_ne!(
            Availability::LocalApiDisabled.message_key(),
            Availability::NotRunning.message_key()
        );
    }
}
