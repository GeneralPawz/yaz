//! Integration tests for the offline Zotero source.
//!
//! The unit tests in `src/sqlite.rs` cover pure functions and never open a
//! database, which means they would all pass against a module whose SQL is
//! wrong. These build a real SQLite file with Zotero's table shapes and query it
//! through the public API.
//!
//! The fixture mirrors the schema of a real library — an annotation hangs off an
//! attachment, which hangs off the item, and that indirection is precisely what
//! is easy to get wrong.
//!
//! Set `YAZ_ZOTERO_DB` to a real `zotero.sqlite` to additionally exercise the
//! queries against a full library. Skipped when unset, because a test suite that
//! depends on the developer's personal library is not a test suite.

use camino::{Utf8Path, Utf8PathBuf};
use rusqlite::Connection;
use yaz_zotero::model::AnnotationKind;
use yaz_zotero::sqlite::SqliteSource;

/// Build a minimal but faithful Zotero database.
fn build_fixture(path: &Utf8Path, userdata_version: i64) {
    let db = Connection::open(path.as_std_path()).unwrap();
    db.execute_batch(
        "
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
        ",
    )
    .unwrap();

    db.execute(
        "INSERT INTO version (schema, version) VALUES ('userdata', ?1)",
        [userdata_version],
    )
    .unwrap();
    db.execute_batch(
        "
        INSERT INTO itemTypes VALUES (1,'journalArticle'),(2,'attachment'),(3,'annotation'),(4,'book');
        INSERT INTO fields VALUES (1,'title'),(2,'date'),(3,'publicationTitle'),(4,'DOI'),(5,'shortTitle');

        -- The citable item.
        INSERT INTO items VALUES (10, 1, 'ITEMAAAA', '2024-01-02 10:00:00');
        INSERT INTO itemDataValues VALUES
            (100,'Semantic validation of information containers'),
            (101,'2024-00-00 2024'),
            (102,'Automation in Construction'),
            (103,'10.1016/j.autcon.2024.001');
        INSERT INTO itemData VALUES (10,1,100),(10,2,101),(10,3,102),(10,4,103);
        INSERT INTO creators VALUES (200,'Jakob','Hagedorn',0),(201,NULL,'European Commission',1);
        INSERT INTO itemCreators VALUES (10,200,1,0),(10,201,1,1);

        -- A second item that must NOT match a search for the first.
        INSERT INTO items VALUES (11, 4, 'ITEMBBBB', '2024-03-04 10:00:00');
        INSERT INTO itemDataValues VALUES (110,'An unrelated book about bridges'),(111,'1998-05-00 05/1998');
        INSERT INTO itemData VALUES (11,1,110),(11,2,111);

        -- The attachment the annotations actually hang off.
        INSERT INTO items VALUES (20, 2, 'ATTACHAA', '2024-01-02 10:05:00');
        INSERT INTO itemAttachments VALUES (20, 10, 'storage:paper.pdf');

        -- Annotations. Note these are items too, which is where their keys live.
        INSERT INTO items VALUES (30, 3, 'ANNOAAAA', '2024-01-03 10:00:00');
        INSERT INTO items VALUES (31, 3, 'ANNOBBBB', '2024-01-03 10:01:00');
        INSERT INTO items VALUES (32, 3, 'ANNOCCCC', '2024-01-03 10:02:00');
        INSERT INTO items VALUES (33, 3, 'ANNODDDD', '2024-01-03 10:03:00');
        INSERT INTO items VALUES (34, 3, 'ANNOEEEE', '2024-01-03 10:04:00');

        INSERT INTO itemAnnotations VALUES
            (30, 20, 1, NULL, 'information containers must be validated', 'key claim', '#ffd400', '21', '00021|0001', '{}', 0),
            (31, 20, 1, NULL, 'a second highlight on unnumbered pages',   NULL,        '#2ea8e5', '-',  '00022|0001', '{}', 0),
            (32, 20, 2, NULL, 'my own private note',                      NULL,        '#a28ae5', '23', '00023|0001', '{}', 0),
            (33, 20, 4, NULL, '',                                          NULL,        '#e56eee', '24', '00024|0001', '{}', 0),
            (34, 20, 1, NULL, 'a highlight the reader later deleted',      NULL,        '#ffd400', '25', '00025|0001', '{}', 0);

        -- The reader trashed that last one.
        INSERT INTO deletedItems VALUES (34, '2024-05-01 10:00:00');
        ",
    )
    .unwrap();
}

fn scratch() -> Utf8PathBuf {
    Utf8PathBuf::from_path_buf(std::env::temp_dir()).unwrap()
}

fn open_fixture(dir: &tempfile::TempDir, version: i64) -> yaz_zotero::Result<SqliteSource> {
    let db = Utf8PathBuf::from_path_buf(dir.path().join("zotero.sqlite")).unwrap();
    build_fixture(&db, version);
    SqliteSource::open(&db, &scratch())
}

#[test]
fn finds_an_item_by_title_and_by_author() {
    let dir = tempfile::tempdir().unwrap();
    let source = open_fixture(&dir, 125).unwrap();

    let by_title = source.search("Semantic validation", 10).unwrap();
    assert_eq!(by_title.len(), 1);
    assert_eq!(by_title[0].key, "ITEMAAAA");
    assert_eq!(by_title[0].year, Some(2024));
    assert_eq!(
        by_title[0].container.as_deref(),
        Some("Automation in Construction")
    );

    let by_author = source.search("Hagedorn", 10).unwrap();
    assert_eq!(by_author.len(), 1);
    assert_eq!(by_author[0].key, "ITEMAAAA");
}

#[test]
fn creators_keep_their_order_and_institutional_names() {
    let dir = tempfile::tempdir().unwrap();
    let source = open_fixture(&dir, 125).unwrap();
    let item = &source.search("Semantic validation", 10).unwrap()[0];
    assert_eq!(
        item.creators,
        vec![
            "Hagedorn, Jakob".to_owned(),
            "European Commission".to_owned()
        ],
        "orderIndex decides the order, and fieldMode 1 is a single name"
    );
}

#[test]
fn attachments_and_annotations_are_never_offered_as_citable_items() {
    let dir = tempfile::tempdir().unwrap();
    let source = open_fixture(&dir, 125).unwrap();
    // Every item in the fixture, via a query broad enough to match all titles.
    let all = source.recent(100).unwrap();
    let types: Vec<&str> = all.iter().map(|i| i.item_type.as_str()).collect();
    assert!(!types.contains(&"attachment"), "got {types:?}");
    assert!(!types.contains(&"annotation"), "got {types:?}");
    assert_eq!(all.len(), 2, "only the two bibliographic items");
}

#[test]
fn annotations_resolve_through_the_attachment_to_the_item() {
    let dir = tempfile::tempdir().unwrap();
    let source = open_fixture(&dir, 125).unwrap();

    // The key point: annotations are asked for by ITEM key, though Zotero
    // stores them against the attachment.
    let annotations = source.annotations("ITEMAAAA").unwrap();
    assert_eq!(annotations.len(), 4, "the trashed one is excluded");
    assert!(annotations.iter().all(|a| a.item_key == "ITEMAAAA"));
    assert!(
        !annotations.iter().any(|a| a.key == "ANNOEEEE"),
        "a trashed annotation must not be offered"
    );
}

#[test]
fn only_text_bearing_marks_are_quotable() {
    let dir = tempfile::tempdir().unwrap();
    let source = open_fixture(&dir, 125).unwrap();
    let annotations = source.annotations("ITEMAAAA").unwrap();

    let quotable: Vec<_> = annotations
        .iter()
        .filter(|a| a.has_quotable_text())
        .collect();
    assert_eq!(
        quotable.len(),
        2,
        "two highlights; the note and ink are not"
    );

    let note = annotations.iter().find(|a| a.key == "ANNOCCCC").unwrap();
    assert_eq!(note.kind, AnnotationKind::Note);
    assert!(
        !note.has_quotable_text(),
        "a note is the reader's words, not the source's"
    );

    let ink = annotations.iter().find(|a| a.key == "ANNODDDD").unwrap();
    assert_eq!(ink.kind, AnnotationKind::Ink);
    assert!(
        !ink.has_quotable_text(),
        "ink marks a region, not a passage"
    );
}

#[test]
fn annotation_detail_survives_the_round_trip() {
    let dir = tempfile::tempdir().unwrap();
    let source = open_fixture(&dir, 125).unwrap();
    let annotations = source.annotations("ITEMAAAA").unwrap();
    let first = annotations.iter().find(|a| a.key == "ANNOAAAA").unwrap();

    assert_eq!(first.text, "information containers must be validated");
    assert_eq!(first.comment.as_deref(), Some("key claim"));
    assert_eq!(first.color.as_deref(), Some("#ffd400"));
    assert_eq!(first.meaningful_page_label(), Some("21"));

    // Zotero writes `-` for an unpaginated attachment, and citing page "-" is
    // worse than citing no page at all.
    let unpaginated = annotations.iter().find(|a| a.key == "ANNOBBBB").unwrap();
    assert_eq!(unpaginated.page_label.as_deref(), Some("-"));
    assert_eq!(unpaginated.meaningful_page_label(), None);
}

#[test]
fn annotations_come_back_in_reading_order() {
    let dir = tempfile::tempdir().unwrap();
    let source = open_fixture(&dir, 125).unwrap();
    let keys: Vec<String> = source
        .annotations("ITEMAAAA")
        .unwrap()
        .into_iter()
        .map(|a| a.key)
        .collect();
    // sortIndex is Zotero's zero-padded position string, so lexical order is
    // document order.
    assert_eq!(keys, vec!["ANNOAAAA", "ANNOBBBB", "ANNOCCCC", "ANNODDDD"]);
}

#[test]
fn a_wildcard_in_the_query_is_not_a_wildcard() {
    let dir = tempfile::tempdir().unwrap();
    let source = open_fixture(&dir, 125).unwrap();
    // Were `%` passed through to LIKE, this would match every item.
    assert!(source.search("%", 10).unwrap().is_empty());
    assert!(source.search("_", 10).unwrap().is_empty());
}

#[test]
fn an_unrecognised_schema_disables_the_source_rather_than_guessing() {
    let dir = tempfile::tempdir().unwrap();
    // ADR-0008: version-checked, and on an unrecognised version we disable the
    // source and say so rather than mis-parse a library.
    let error = open_fixture(&dir, 999).unwrap_err();
    assert!(
        matches!(
            error,
            yaz_zotero::Error::UnsupportedSchema { found: 999, .. }
        ),
        "got {error:?}"
    );
    assert!(error.is_source_unavailable(), "it should fall through");

    let old = tempfile::tempdir().unwrap();
    assert!(matches!(
        open_fixture(&old, 95).unwrap_err(),
        yaz_zotero::Error::UnsupportedSchema { found: 95, .. }
    ));
}

#[test]
fn a_missing_library_is_reported_as_such() {
    let error = SqliteSource::open(
        &Utf8PathBuf::from("/definitely/not/here/zotero.sqlite"),
        &scratch(),
    )
    .unwrap_err();
    assert!(matches!(error, yaz_zotero::Error::NoLibrary { .. }));
    assert!(error.is_source_unavailable());
}

#[test]
fn the_original_library_is_never_opened_directly() {
    let dir = tempfile::tempdir().unwrap();
    let db = Utf8PathBuf::from_path_buf(dir.path().join("zotero.sqlite")).unwrap();
    build_fixture(&db, 125);

    let before = std::fs::metadata(db.as_std_path()).unwrap().len();
    let source = SqliteSource::open(&db, &scratch()).unwrap();
    let _ = source.recent(10).unwrap();
    drop(source);

    // Opening SQLite read-write creates a journal beside the file and can
    // rewrite the header even without an explicit write. The library must be
    // byte-for-byte untouched.
    assert_eq!(std::fs::metadata(db.as_std_path()).unwrap().len(), before);
    assert!(
        !dir.path().join("zotero.sqlite-journal").exists(),
        "a journal file means the original was opened read-write"
    );
    assert!(!dir.path().join("zotero.sqlite-wal").exists());
}

/// Exercise the queries against a real library when one is pointed at.
///
/// Skipped rather than failed when unset: the fixture above is what runs in CI.
#[test]
fn real_library_if_available() {
    let Ok(path) = std::env::var("YAZ_ZOTERO_DB") else {
        eprintln!("YAZ_ZOTERO_DB unset — skipping the real-library pass");
        return;
    };
    let db = Utf8PathBuf::from(path);
    let source = SqliteSource::open(&db, &scratch()).expect("real library should open");
    eprintln!("schema userdata {}", source.schema_version);

    let recent = source.recent(5).unwrap();
    assert!(!recent.is_empty(), "a real library should have items");

    // A picker types into this on every keystroke. The two-pass query exists so
    // that cost stays proportional to the page size rather than the library, and
    // this is where that claim is actually checked — against a full library, not
    // the fixture.
    let started = std::time::Instant::now();
    let hits = source.search(&recent[0].title.chars().take(8).collect::<String>(), 50);
    let elapsed = started.elapsed();
    hits.expect("search should succeed on a real library");
    eprintln!("search over the full library took {elapsed:?}");
    assert!(
        elapsed < std::time::Duration::from_millis(500),
        "search took {elapsed:?}, which would make the picker feel broken"
    );
    for item in &recent {
        assert!(!item.key.is_empty());
        assert!(
            !matches!(
                item.item_type.as_str(),
                "attachment" | "note" | "annotation"
            ),
            "non-citable type leaked: {}",
            item.item_type
        );
    }

    // Find something with annotations and check the join really resolves.
    let mut found_any = false;
    for item in source.recent(400).unwrap() {
        let annotations = source.annotations(&item.key).unwrap();
        if annotations.is_empty() {
            continue;
        }
        found_any = true;
        assert!(annotations.iter().all(|a| a.item_key == item.key));
        eprintln!(
            "{} — {} annotation(s), {} quotable",
            item.key,
            annotations.len(),
            annotations.iter().filter(|a| a.has_quotable_text()).count()
        );
        break;
    }
    assert!(
        found_any,
        "no annotations found in 400 recent items — the join is probably wrong"
    );
}

/// The facade must degrade to the offline library rather than reporting failure.
///
/// Hermetic: it points at a fixture data directory, and relies only on there
/// being no Zotero listening on the loopback port, which is the ordinary state
/// on a build machine.
#[tokio::test]
async fn the_facade_falls_through_to_sqlite_when_zotero_is_closed() {
    let dir = tempfile::tempdir().unwrap();
    let data_dir = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
    build_fixture(&data_dir.join("zotero.sqlite"), 125);

    let config = yaz_zotero::Config {
        data_dir: Some(data_dir.clone()),
        scratch: scratch(),
    };
    let library =
        yaz_zotero::Library::connect(&config, yaz_core::net::http_client().unwrap()).await;

    assert_eq!(
        library.source(),
        yaz_zotero::ActiveSource::Sqlite,
        "with Zotero closed the offline library must answer: {:?}",
        library.failure
    );
    assert!(
        !library.source().is_live(),
        "and it must not claim to be live"
    );
    assert!(
        !library.keys_are_authoritative(),
        "generated keys may disagree with a co-author's, and that must be flagged"
    );

    // And it must actually answer queries, not merely report a source.
    let items = library.search("Semantic validation", 10).await.unwrap();
    assert_eq!(items.len(), 1);
    let annotations = library.annotations(&items[0].key).await.unwrap();
    assert_eq!(
        annotations.iter().filter(|a| a.has_quotable_text()).count(),
        2
    );
}

/// An empty query lists something, so the picker is never blank on open.
#[tokio::test]
async fn an_empty_query_lists_recent_items() {
    let dir = tempfile::tempdir().unwrap();
    let data_dir = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
    build_fixture(&data_dir.join("zotero.sqlite"), 125);

    let config = yaz_zotero::Config {
        data_dir: Some(data_dir),
        scratch: scratch(),
    };
    let library =
        yaz_zotero::Library::connect(&config, yaz_core::net::http_client().unwrap()).await;
    assert_eq!(library.search("", 10).await.unwrap().len(), 2);
    assert_eq!(library.search("   ", 10).await.unwrap().len(), 2);
}

/// Looking an item up by key is not a search, and must not be routed through one.
///
/// This is a regression test. `ensure_in_bibliography` originally found its item
/// by calling `search(item_key)` and filtering the results — which finds nothing,
/// because a Zotero key appears in no field a reader would ever search on. Every
/// citation insert failed.
#[test]
fn an_item_is_found_by_key_even_though_search_cannot_find_it() {
    let dir = tempfile::tempdir().unwrap();
    let source = open_fixture(&dir, 125).unwrap();

    let found = source.find("ITEMAAAA").unwrap().expect("the item exists");
    assert_eq!(found.key, "ITEMAAAA");
    assert_eq!(found.title, "Semantic validation of information containers");

    // The bug, made explicit: search over the key finds nothing.
    assert!(
        source.search("ITEMAAAA", 10).unwrap().is_empty(),
        "a key is not searchable text, which is exactly why find() exists"
    );
}

#[test]
fn a_missing_key_is_none_rather_than_an_error() {
    let dir = tempfile::tempdir().unwrap();
    let source = open_fixture(&dir, 125).unwrap();
    assert!(source.find("NOSUCHKEY").unwrap().is_none());
}

#[test]
fn an_attachment_key_is_not_a_citable_item() {
    // The attachment exists in `items`, so a naive lookup would return it and a
    // citation would point at a PDF rather than at a work.
    let dir = tempfile::tempdir().unwrap();
    let source = open_fixture(&dir, 125).unwrap();
    assert!(source.find("ATTACHAA").unwrap().is_none());
    assert!(source.find("ANNOAAAA").unwrap().is_none());
}

/// The exact failure reported from the running application.
///
/// Zotero was open, an item called "Test Speaking" existed, and the picker said
/// "could not load the list". The cause was a probe of `/connector/ping`, which
/// answers 200 whenever Zotero is running at all — while the local API, a
/// separate and disabled-by-default feature, returned 403 to every query.
///
/// This drives the real facade against the real library, so it covers the probe,
/// the demotion, and the fallback together. Skipped when `YAZ_ZOTERO_DIR` is
/// unset; the hermetic tests above are what run in CI.
#[tokio::test]
async fn a_real_library_answers_whether_or_not_the_local_api_is_enabled() {
    let Ok(dir) = std::env::var("YAZ_ZOTERO_DIR") else {
        eprintln!("YAZ_ZOTERO_DIR unset — skipping the live-Zotero pass");
        return;
    };
    let config = yaz_zotero::Config {
        data_dir: Some(Utf8PathBuf::from(dir)),
        scratch: scratch(),
    };
    let library =
        yaz_zotero::Library::connect(&config, yaz_core::net::http_client().unwrap()).await;

    eprintln!(
        "live probe: {:?}   active source: {:?}",
        library.live_status,
        library.source()
    );
    assert_ne!(
        library.source(),
        yaz_zotero::ActiveSource::None,
        "some source must answer: {:?}",
        library.failure
    );

    // The query that failed in the application.
    let hits = library
        .search("Test Speaking", 20)
        .await
        .expect("the picker's query must not error");
    eprintln!("'Test Speaking' matched {} item(s)", hits.len());
    for item in hits.iter().take(3) {
        eprintln!("   {} — {}", item.key, item.title);
    }
    assert!(
        !hits.is_empty(),
        "the item exists in the library, so the picker must find it"
    );

    // And an empty query must list something, or the picker opens blank.
    assert!(!library.search("", 10).await.unwrap().is_empty());
}

/// The copy is reused rather than rewritten on every open.
///
/// Regression test. The first version named the copy per open and deleted it on
/// `Drop` — which does not run when a process is killed, and a desktop
/// application is killed constantly. The machine this was found on had 201
/// leaked copies totalling a gigabyte, and rewriting a 146 MB file on every
/// launch is also what made startup visibly slow, because Windows Defender
/// scans a freshly written file of that size.
#[test]
fn the_cached_copy_is_reused_when_the_library_has_not_changed() {
    let dir = tempfile::tempdir().unwrap();
    let scratch = tempfile::tempdir().unwrap();
    let scratch_dir = Utf8PathBuf::from_path_buf(scratch.path().to_path_buf()).unwrap();
    let db = Utf8PathBuf::from_path_buf(dir.path().join("zotero.sqlite")).unwrap();
    build_fixture(&db, 125);

    let first = SqliteSource::open(&db, &scratch_dir).unwrap();
    let cache = first.cache_path.clone();
    let written_at = std::fs::metadata(cache.as_std_path())
        .unwrap()
        .modified()
        .unwrap();
    drop(first);

    // The copy must survive the source being dropped: it is a cache.
    assert!(
        cache.as_std_path().is_file(),
        "the copy was deleted on drop"
    );

    let second = SqliteSource::open(&db, &scratch_dir).unwrap();
    assert_eq!(
        second.cache_path, cache,
        "a second open must reuse the copy"
    );
    assert_eq!(
        std::fs::metadata(cache.as_std_path())
            .unwrap()
            .modified()
            .unwrap(),
        written_at,
        "the copy was rewritten even though the library had not changed"
    );

    // Exactly one copy, however many times it is opened.
    let copies = std::fs::read_dir(scratch.path())
        .unwrap()
        .filter_map(Result::ok)
        .filter(|e| e.file_name().to_string_lossy().starts_with("yaz-zotero-"))
        .count();
    assert_eq!(copies, 1, "one cache per library, not one per open");
}

#[test]
fn a_changed_library_refreshes_the_copy() {
    let dir = tempfile::tempdir().unwrap();
    let scratch = tempfile::tempdir().unwrap();
    let scratch_dir = Utf8PathBuf::from_path_buf(scratch.path().to_path_buf()).unwrap();
    let db = Utf8PathBuf::from_path_buf(dir.path().join("zotero.sqlite")).unwrap();
    build_fixture(&db, 125);

    let cache = SqliteSource::open(&db, &scratch_dir)
        .unwrap()
        .cache_path
        .clone();

    // Zotero writes: add another item, which changes size and timestamp.
    let connection = rusqlite::Connection::open(db.as_std_path()).unwrap();
    connection
        .execute_batch(
            "INSERT INTO items VALUES (99, 1, 'NEWITEM1', '2025-01-01 00:00:00');
             INSERT INTO itemDataValues VALUES (900,'A brand new paper');
             INSERT INTO itemData VALUES (99,1,900);",
        )
        .unwrap();
    drop(connection);

    let refreshed = SqliteSource::open(&db, &scratch_dir).unwrap();
    // The content is the assertion that matters: a stale cache would hide the
    // new item, which is far worse than a slow copy.
    assert!(
        refreshed.find("NEWITEM1").unwrap().is_some(),
        "the cache was not refreshed after the library changed"
    );
    // Note this deliberately does not compare file *size*. SQLite reused a free
    // page, so the file is byte-identical in length while its contents differ —
    // which is exactly why `copy_is_current` compares the modification time too
    // and not size alone.
    assert!(
        std::fs::metadata(cache.as_std_path())
            .unwrap()
            .modified()
            .unwrap()
            >= std::fs::metadata(db.as_std_path())
                .unwrap()
                .modified()
                .unwrap(),
        "the copy should be at least as new as the library"
    );
}

#[test]
fn copies_leaked_by_the_old_naming_scheme_are_swept_up() {
    let dir = tempfile::tempdir().unwrap();
    let scratch = tempfile::tempdir().unwrap();
    let scratch_dir = Utf8PathBuf::from_path_buf(scratch.path().to_path_buf()).unwrap();
    let db = Utf8PathBuf::from_path_buf(dir.path().join("zotero.sqlite")).unwrap();
    build_fixture(&db, 125);

    // What the previous version left behind, one per launch.
    for n in 0..5 {
        std::fs::write(
            scratch.path().join(format!("yaz-zotero-1234-{n}.sqlite")),
            b"junk",
        )
        .unwrap();
    }
    // Another library's cache, which must NOT be swept: two Zotero profiles on
    // one machine would otherwise take turns deleting each other's copy.
    let other = scratch
        .path()
        .join("yaz-zotero-cache-deadbeefdeadbeef.sqlite");
    std::fs::write(&other, b"someone else's").unwrap();

    let _source = SqliteSource::open(&db, &scratch_dir).unwrap();

    let leaked = std::fs::read_dir(scratch.path())
        .unwrap()
        .filter_map(Result::ok)
        .filter(|e| {
            e.file_name()
                .to_string_lossy()
                .starts_with("yaz-zotero-1234-")
        })
        .count();
    assert_eq!(leaked, 0, "old-style copies should be swept");
    assert!(
        other.is_file(),
        "another library's cache must be left alone"
    );
}
