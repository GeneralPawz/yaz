//! The library types every source is normalised into.
//!
//! These deliberately do not mirror Zotero's schema. Each of the four sources in
//! [ADR-0008] describes an item differently — Better BibTeX returns a citation
//! key it owns, the local API returns CSL-shaped JSON, sqlite returns rows of a
//! key/value field table — and a caller that had to know which source answered
//! would defeat the point of having the abstraction.
//!
//! What callers *do* need to know is whether the answer is current, which is why
//! the source is reported separately rather than smuggled into these types.
//!
//! [ADR-0008]: https://github.com/GeneralPawz/yaz/blob/main/docs/adr/0008-zotero-integration.md

use serde::{Deserialize, Serialize};

/// A bibliographic item: something citable.
///
/// Attachments, notes and annotations are deliberately not items here, even
/// though Zotero stores them in the same table.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    /// Zotero's own item key, stable across sync. The identifier used everywhere
    /// else in this crate.
    pub key: String,

    /// The citation key, when a source can supply an authoritative one.
    ///
    /// `None` means no source owned a key for this item, and one will be
    /// generated. That distinction is preserved rather than papered over: a
    /// generated key may not match what a co-author's Better BibTeX produces,
    /// and the user is told so.
    pub citation_key: Option<String>,

    /// Zotero's item type, e.g. `journalArticle`.
    pub item_type: String,

    /// Item title. Empty when the item genuinely has none.
    pub title: String,

    /// Creators in Zotero's order, already formatted for display.
    pub creators: Vec<String>,

    /// Publication year, when one could be parsed.
    pub year: Option<i32>,

    /// Publication, journal, or book title, when the item has one.
    pub container: Option<String>,

    /// DOI, when recorded.
    pub doi: Option<String>,
}

impl Item {
    /// A short label for a picker row: creators, year and title.
    ///
    /// Returns the pieces rather than a formatted string on purpose. Assembling
    /// user-facing text in Rust would hardcode an ordering and a separator that
    /// are the locale's business, not this crate's ([ADR-0011]).
    ///
    /// [ADR-0011]: https://github.com/GeneralPawz/yaz/blob/main/docs/adr/0011-localisation.md
    pub fn first_creator(&self) -> Option<&str> {
        self.creators.first().map(String::as_str)
    }
}

/// What kind of mark a reader left on a document.
///
/// Zotero stores these as integers; the mapping is in [`crate::sqlite`]. Only
/// the variants that carry text are useful for quoting, which
/// [`Annotation::has_quotable_text`] exists to express.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[non_exhaustive]
pub enum AnnotationKind {
    /// Highlighted text.
    Highlight,
    /// A standalone note, not anchored to text.
    Note,
    /// A rectangular image selection.
    Image,
    /// Freehand ink.
    Ink,
    /// Underlined text.
    Underline,
    /// A kind this version does not recognise.
    ///
    /// Zotero adds annotation types over time, and refusing to load a library
    /// because it contains a newer one would be the wrong trade. Carried through
    /// so the count a user sees matches what Zotero shows them.
    Other,
}

impl AnnotationKind {
    /// Whether this kind marks text that can be quoted.
    ///
    /// Ink and image annotations mark a *region*, not a passage; they have no
    /// text to insert. A note has text, but it is the reader's own words rather
    /// than the source's, so quoting it as if it were the source would
    /// misattribute it.
    pub fn is_quotable(&self) -> bool {
        matches!(self, AnnotationKind::Highlight | AnnotationKind::Underline)
    }

    /// Message key naming this kind in the interface.
    pub fn label_key(&self) -> &'static str {
        match self {
            AnnotationKind::Highlight => "zotero-annotation-highlight",
            AnnotationKind::Note => "zotero-annotation-note",
            AnnotationKind::Image => "zotero-annotation-image",
            AnnotationKind::Ink => "zotero-annotation-ink",
            AnnotationKind::Underline => "zotero-annotation-underline",
            AnnotationKind::Other => "zotero-annotation-other",
        }
    }
}

/// A passage a reader marked in an attachment, with the reader's own comment.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Annotation {
    /// Zotero's key for the annotation itself.
    pub key: String,

    /// The item this annotation ultimately belongs to.
    ///
    /// Zotero anchors an annotation to an *attachment*, and the attachment to an
    /// item. That indirection is resolved here, because a caller inserting a
    /// citation needs the citable item, not the PDF.
    pub item_key: String,

    /// What kind of mark this is.
    pub kind: AnnotationKind,

    /// The marked text, as it appears in the document.
    ///
    /// Empty for kinds that mark a region rather than text.
    pub text: String,

    /// The reader's own comment. Never quoted as if it were the source.
    pub comment: Option<String>,

    /// Highlight colour as Zotero records it, e.g. `#ffd400`.
    ///
    /// Carried because readers encode meaning in colour — one for claims, another
    /// for method — and a picker that discards it throws away the only
    /// organisation many libraries have.
    pub color: Option<String>,

    /// The page label as displayed, which is not always a number.
    ///
    /// Front matter is commonly `iv`, and an unpaginated document yields `-`.
    /// Kept as the document's own label so a citation matches what a reader
    /// checking the source would see.
    pub page_label: Option<String>,
}

impl Annotation {
    /// Whether this annotation carries text worth offering as a quotation.
    pub fn has_quotable_text(&self) -> bool {
        self.kind.is_quotable() && !self.text.trim().is_empty()
    }

    /// The page label, if it is one the document actually assigned.
    ///
    /// Zotero writes `-` for an attachment with no pagination. Passing that
    /// through into `\cite[-]{key}` would produce a citation claiming the
    /// passage is on a page called "-".
    pub fn meaningful_page_label(&self) -> Option<&str> {
        self.page_label
            .as_deref()
            .map(str::trim)
            .filter(|label| !label.is_empty() && *label != "-")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn annotation(kind: AnnotationKind, text: &str, page: Option<&str>) -> Annotation {
        Annotation {
            key: "AAAA1111".into(),
            item_key: "BBBB2222".into(),
            kind,
            text: text.into(),
            comment: None,
            color: None,
            page_label: page.map(str::to_owned),
        }
    }

    #[test]
    fn only_text_marking_kinds_are_quotable() {
        assert!(AnnotationKind::Highlight.is_quotable());
        assert!(AnnotationKind::Underline.is_quotable());
        // A note is the reader's words, not the source's.
        assert!(!AnnotationKind::Note.is_quotable());
        assert!(!AnnotationKind::Ink.is_quotable());
        assert!(!AnnotationKind::Image.is_quotable());
        assert!(!AnnotationKind::Other.is_quotable());
    }

    #[test]
    fn a_highlight_with_only_whitespace_is_not_quotable() {
        assert!(!annotation(AnnotationKind::Highlight, "   \n ", None).has_quotable_text());
        assert!(annotation(AnnotationKind::Highlight, "real text", None).has_quotable_text());
    }

    #[test]
    fn the_unpaginated_placeholder_is_not_a_page_label() {
        // Real libraries are full of these: Zotero writes `-` when the
        // attachment has no pagination at all.
        assert_eq!(
            annotation(AnnotationKind::Highlight, "t", Some("-")).meaningful_page_label(),
            None
        );
        assert_eq!(
            annotation(AnnotationKind::Highlight, "t", Some("  ")).meaningful_page_label(),
            None
        );
        // Front matter is numbered in roman numerals, and that is a real label.
        assert_eq!(
            annotation(AnnotationKind::Highlight, "t", Some("iv")).meaningful_page_label(),
            Some("iv")
        );
        assert_eq!(
            annotation(AnnotationKind::Highlight, "t", Some("21")).meaningful_page_label(),
            Some("21")
        );
    }
}
