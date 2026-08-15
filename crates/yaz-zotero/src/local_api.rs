//! Zotero 7's local HTTP API.
//!
//! Zotero serves a read-only mirror of its web API on `127.0.0.1:23119` while it
//! is running. That gives a live view of the library without touching the
//! database file, and without Better BibTeX being installed.
//!
//! # Loopback only, and that is a capability decision
//!
//! Every request here goes to `127.0.0.1`. The plugin declares
//! `net` for that host and nothing else, so a compromised or careless plugin
//! cannot turn the Zotero bridge into a general-purpose HTTP client — see
//! [ADR-0006]. The host is a constant in this module rather than a parameter for
//! the same reason: a configurable Zotero host would be a configurable
//! exfiltration target.
//!
//! # Verification status
//!
//! The queries here are written against Zotero's documented local API and are
//! covered by tests that parse **recorded response shapes**, not by tests
//! against a running Zotero. Until this has been exercised against a live
//! instance, treat the sqlite source as the one with evidence behind it.
//!
//! [ADR-0006]: https://github.com/GeneralPawz/yaz/blob/main/docs/adr/0006-plugin-runtime-and-capabilities.md

use serde::Deserialize;

use crate::error::{Error, Result};
use crate::model::{Annotation, AnnotationKind, Item};

/// The loopback address Zotero listens on. Not configurable, deliberately.
pub const ZOTERO_HOST: &str = "127.0.0.1";

/// The port Zotero's connector and local API share.
pub const ZOTERO_PORT: u16 = 23119;

/// Base URL for the local API.
fn base() -> String {
    format!("http://{ZOTERO_HOST}:{ZOTERO_PORT}/api/users/0")
}

/// A client for a locally running Zotero.
#[derive(Debug, Clone)]
pub struct LocalApi {
    http: reqwest::Client,
}

/// The envelope every local-API item comes in.
#[derive(Debug, Deserialize)]
struct Envelope<T> {
    key: String,
    data: T,
    #[serde(default)]
    meta: Meta,
}

#[derive(Debug, Default, Deserialize)]
struct Meta {
    #[serde(default)]
    #[serde(rename = "parsedDate")]
    parsed_date: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ItemData {
    #[serde(default)]
    item_type: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    creators: Vec<Creator>,
    #[serde(default)]
    date: Option<String>,
    #[serde(default)]
    publication_title: Option<String>,
    #[serde(default, rename = "DOI")]
    doi: Option<String>,
    /// Better BibTeX writes its key here when it is installed, so an
    /// authoritative key can arrive even on this tier.
    #[serde(default)]
    citation_key: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Creator {
    #[serde(default)]
    first_name: Option<String>,
    #[serde(default)]
    last_name: Option<String>,
    /// Institutional creators carry a single `name` instead of a split pair.
    #[serde(default)]
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AnnotationData {
    #[serde(default)]
    item_type: String,
    #[serde(default)]
    annotation_type: Option<String>,
    #[serde(default)]
    annotation_text: Option<String>,
    #[serde(default)]
    annotation_comment: Option<String>,
    #[serde(default)]
    annotation_color: Option<String>,
    #[serde(default)]
    annotation_page_label: Option<String>,
}

impl LocalApi {
    /// Wrap an HTTP client.
    ///
    /// The client comes from [`yaz_core::net::http_client`] so that the trust
    /// policy in ADR-0019 has exactly one implementation.
    pub fn new(http: reqwest::Client) -> Self {
        Self { http }
    }

    /// Whether a Zotero is answering right now.
    ///
    /// A refused connection is the ordinary case — most writers have Zotero
    /// closed most of the time — so this returns a bool rather than an error.
    pub async fn is_running(&self) -> bool {
        self.http
            .get(format!("http://{ZOTERO_HOST}:{ZOTERO_PORT}/connector/ping"))
            .timeout(std::time::Duration::from_millis(750))
            .send()
            .await
            .is_ok()
    }

    /// Search the library.
    pub async fn search(&self, query: &str, limit: usize) -> Result<Vec<Item>> {
        let url = format!("{}/items", base());
        let response = self
            .http
            .get(&url)
            .query(&[
                ("q", query),
                ("limit", &limit.to_string()),
                ("format", "json"),
                // Ask Zotero to leave out the things that are not citable
                // rather than filtering them out after transfer.
                ("itemType", "-attachment || note || annotation"),
            ])
            .send()
            .await
            .map_err(http)?;

        let body = response.text().await.map_err(http)?;
        parse_items(&body)
    }

    /// Every marked passage on an item.
    ///
    /// Two hops, because Zotero models annotations as children of the
    /// *attachment*: item → attachments → annotations.
    pub async fn annotations(&self, item_key: &str) -> Result<Vec<Annotation>> {
        let children = self.children(item_key).await?;
        let attachment_keys: Vec<String> = parse_attachment_keys(&children);

        let mut all = Vec::new();
        for attachment in attachment_keys {
            let body = self.children(&attachment).await?;
            all.extend(parse_annotations(&body, item_key)?);
        }
        Ok(all)
    }

    async fn children(&self, key: &str) -> Result<String> {
        let url = format!("{}/items/{key}/children", base());
        self.http
            .get(&url)
            .query(&[("format", "json")])
            .send()
            .await
            .map_err(http)?
            .text()
            .await
            .map_err(http)
    }
}

fn http(source: reqwest::Error) -> Error {
    // A refused connection means Zotero is closed, which is not a failure worth
    // showing anyone — it is the signal to fall through to the next source.
    if source.is_connect() {
        return Error::NotRunning;
    }
    Error::Http {
        source: Box::new(source),
    }
}

/// Parse a local-API item listing.
fn parse_items(body: &str) -> Result<Vec<Item>> {
    let envelopes: Vec<Envelope<ItemData>> =
        serde_json::from_str(body).map_err(|_| Error::UnexpectedResponse {
            source_name: "local-api",
        })?;

    Ok(envelopes
        .into_iter()
        .filter(|e| {
            !matches!(
                e.data.item_type.as_str(),
                "attachment" | "note" | "annotation"
            )
        })
        .map(|e| Item {
            key: e.key,
            citation_key: e.data.citation_key.filter(|k| !k.is_empty()),
            item_type: e.data.item_type,
            title: e.data.title,
            creators: e
                .data
                .creators
                .into_iter()
                .filter_map(format_creator)
                .collect(),
            // `meta.parsedDate` is Zotero's own normalisation and is more
            // reliable than re-parsing the free-text `date` field.
            year: e
                .meta
                .parsed_date
                .as_deref()
                .or(e.data.date.as_deref())
                .and_then(parse_year),
            container: e.data.publication_title.filter(|s| !s.is_empty()),
            doi: e.data.doi.filter(|s| !s.is_empty()),
        })
        .collect())
}

fn format_creator(creator: Creator) -> Option<String> {
    if let Some(name) = creator
        .name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        return Some(name.to_owned());
    }
    let first = creator
        .first_name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let last = creator
        .last_name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    match (first, last) {
        (Some(first), Some(last)) => Some(format!("{last}, {first}")),
        (None, Some(last)) => Some(last.to_owned()),
        (Some(first), None) => Some(first.to_owned()),
        (None, None) => None,
    }
}

/// Keys of the attachments among an item's children.
fn parse_attachment_keys(body: &str) -> Vec<String> {
    #[derive(Deserialize)]
    struct Child {
        key: String,
        data: ChildData,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct ChildData {
        #[serde(default)]
        item_type: String,
    }

    serde_json::from_str::<Vec<Child>>(body)
        .map(|children| {
            children
                .into_iter()
                .filter(|c| c.data.item_type == "attachment")
                .map(|c| c.key)
                .collect()
        })
        .unwrap_or_default()
}

/// Parse annotations out of an attachment's children.
fn parse_annotations(body: &str, item_key: &str) -> Result<Vec<Annotation>> {
    let envelopes: Vec<Envelope<AnnotationData>> =
        serde_json::from_str(body).map_err(|_| Error::UnexpectedResponse {
            source_name: "local-api",
        })?;

    Ok(envelopes
        .into_iter()
        .filter(|e| e.data.item_type == "annotation")
        .map(|e| Annotation {
            key: e.key,
            item_key: item_key.to_owned(),
            kind: annotation_kind(e.data.annotation_type.as_deref()),
            text: e.data.annotation_text.unwrap_or_default(),
            comment: e.data.annotation_comment.filter(|c| !c.trim().is_empty()),
            color: e.data.annotation_color.filter(|c| !c.is_empty()),
            page_label: e.data.annotation_page_label,
        })
        .collect())
}

/// The local API names annotation types where sqlite numbers them.
fn annotation_kind(name: Option<&str>) -> AnnotationKind {
    match name {
        Some("highlight") => AnnotationKind::Highlight,
        Some("note") => AnnotationKind::Note,
        Some("image") => AnnotationKind::Image,
        Some("ink") => AnnotationKind::Ink,
        Some("underline") => AnnotationKind::Underline,
        _ => AnnotationKind::Other,
    }
}

/// Leading four-digit year, matching the sqlite source's rule.
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

#[cfg(test)]
mod tests {
    use super::*;

    // Recorded from Zotero's documented local API response shape.
    const ITEMS: &str = r#"[
      {
        "key": "ITEMAAAA",
        "version": 12,
        "meta": { "creatorSummary": "Hagedorn", "parsedDate": "2024-01-01" },
        "data": {
          "key": "ITEMAAAA",
          "itemType": "journalArticle",
          "title": "Semantic validation of information containers",
          "creators": [
            { "creatorType": "author", "firstName": "Jakob", "lastName": "Hagedorn" },
            { "creatorType": "author", "name": "European Commission" }
          ],
          "date": "2024",
          "publicationTitle": "Automation in Construction",
          "DOI": "10.1016/j.autcon.2024.001"
        }
      },
      {
        "key": "ATTACHAA",
        "version": 13,
        "meta": {},
        "data": { "key": "ATTACHAA", "itemType": "attachment", "title": "paper.pdf" }
      }
    ]"#;

    const ANNOTATIONS: &str = r##"[
      {
        "key": "ANNOAAAA",
        "version": 20,
        "meta": {},
        "data": {
          "key": "ANNOAAAA",
          "itemType": "annotation",
          "annotationType": "highlight",
          "annotationText": "information containers must be validated",
          "annotationComment": "key claim",
          "annotationColor": "#ffd400",
          "annotationPageLabel": "21"
        }
      },
      {
        "key": "ANNOBBBB",
        "version": 21,
        "meta": {},
        "data": {
          "key": "ANNOBBBB",
          "itemType": "annotation",
          "annotationType": "ink",
          "annotationColor": "#e56eee",
          "annotationPageLabel": "24"
        }
      }
    ]"##;

    #[test]
    fn items_parse_and_attachments_are_dropped() {
        let items = parse_items(ITEMS).unwrap();
        assert_eq!(items.len(), 1, "the attachment must not be citable");
        let item = &items[0];
        assert_eq!(item.key, "ITEMAAAA");
        assert_eq!(item.year, Some(2024));
        assert_eq!(item.doi.as_deref(), Some("10.1016/j.autcon.2024.001"));
    }

    #[test]
    fn institutional_and_personal_creators_both_format() {
        let items = parse_items(ITEMS).unwrap();
        assert_eq!(
            items[0].creators,
            vec![
                "Hagedorn, Jakob".to_owned(),
                "European Commission".to_owned()
            ]
        );
    }

    #[test]
    fn annotations_parse_with_their_kinds() {
        let annotations = parse_annotations(ANNOTATIONS, "ITEMAAAA").unwrap();
        assert_eq!(annotations.len(), 2);
        assert_eq!(annotations[0].kind, AnnotationKind::Highlight);
        assert!(annotations[0].has_quotable_text());
        assert_eq!(annotations[0].comment.as_deref(), Some("key claim"));

        // Ink carries no text, and must not be offered as a quotation.
        assert_eq!(annotations[1].kind, AnnotationKind::Ink);
        assert!(!annotations[1].has_quotable_text());
    }

    #[test]
    fn annotations_are_attributed_to_the_item_not_the_attachment() {
        // The whole reason for the two-hop walk.
        let annotations = parse_annotations(ANNOTATIONS, "ITEMAAAA").unwrap();
        assert!(annotations.iter().all(|a| a.item_key == "ITEMAAAA"));
    }

    #[test]
    fn attachment_keys_are_picked_out_of_children() {
        assert_eq!(parse_attachment_keys(ITEMS), vec!["ATTACHAA".to_owned()]);
    }

    #[test]
    fn a_garbled_response_is_reported_rather_than_silently_empty() {
        // Returning an empty list here would read as "this item has no
        // annotations", which is a lie the user cannot detect.
        let error = parse_items("<html>not json</html>").unwrap_err();
        assert!(matches!(
            error,
            Error::UnexpectedResponse {
                source_name: "local-api"
            }
        ));
        assert!(parse_annotations("nonsense", "K").is_err());
    }

    #[test]
    fn the_host_is_loopback_and_not_configurable() {
        // A configurable Zotero host would be a configurable exfiltration
        // target for anything holding the `net` capability.
        assert_eq!(ZOTERO_HOST, "127.0.0.1");
        assert!(base().starts_with("http://127.0.0.1:23119/"));
    }
}
