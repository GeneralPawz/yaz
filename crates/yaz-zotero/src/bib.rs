//! Citation keys and `.bib` entries.
//!
//! # Why this exists even though Zotero can export
//!
//! [ADR-0008] makes the project `.bib` the compile-time source of truth: a
//! document must build on a co-author's machine that has never had Zotero
//! installed. So inserting a citation copies the entry into the project rather
//! than pointing at the library.
//!
//! # Keys we generate are not keys Better BibTeX generates
//!
//! When Better BibTeX is running it owns the citation key, and we use its answer
//! because that key is what already appears in `.bib` files and in
//! collaborators' documents. Without it we generate one, and the two can differ.
//! That is surfaced to the user rather than hidden — a citation key that
//! silently disagrees with a co-author's is a genuinely annoying problem to
//! debug, and the tool knows perfectly well which case it is in.
//!
//! [ADR-0008]: https://github.com/GeneralPawz/yaz/blob/main/docs/adr/0008-zotero-integration.md

use std::collections::HashSet;

use crate::model::Item;

/// Generate a deterministic citation key: `surnameYEARword`.
///
/// Deterministic on purpose. The same item must produce the same key on every
/// machine and every run, or a project's `.bib` churns every time somebody cites
/// something.
///
/// The shape follows Better BibTeX's default so that a library which later gains
/// BBT mostly agrees with what we already wrote. "Mostly" is doing real work in
/// that sentence, which is why [`crate::Item::citation_key`] records whether a
/// key was authoritative.
pub fn generate_key(item: &Item) -> String {
    let surname = item
        .first_creator()
        .map(surname_of)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "anon".to_owned());

    let year = item
        .year
        .map(|y| y.to_string())
        .unwrap_or_else(|| "nd".to_owned());

    let word = first_significant_word(&item.title);

    format!("{surname}{year}{word}")
}

/// Make a key unique against keys already present in a bibliography.
///
/// Two papers by the same author in the same year with the same leading title
/// word is not a hypothetical — conference series produce them routinely.
/// Suffixes follow the usual `a`, `b`, `c` convention.
pub fn disambiguate(base: &str, taken: &HashSet<String>) -> String {
    if !taken.contains(base) {
        return base.to_owned();
    }
    for suffix in b'a'..=b'z' {
        let candidate = format!("{base}{}", suffix as char);
        if !taken.contains(&candidate) {
            return candidate;
        }
    }
    // Twenty-six collisions on one key is pathological; fall back to a counter
    // rather than returning a duplicate, which would silently merge citations.
    let mut n = 2usize;
    loop {
        let candidate = format!("{base}-{n}");
        if !taken.contains(&candidate) {
            return candidate;
        }
        n += 1;
    }
}

/// The surname from a creator string formatted as `Last, First`.
fn surname_of(creator: &str) -> String {
    let surname = creator.split(',').next().unwrap_or(creator);
    ascii_fold(surname)
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect::<String>()
        .to_lowercase()
}

/// The first title word that carries meaning.
///
/// Leading articles and prepositions make for keys that all look alike —
/// `smith2024the` tells a reader nothing.
fn first_significant_word(title: &str) -> String {
    const SKIP: [&str; 12] = [
        "a", "an", "the", "on", "of", "in", "for", "to", "and", "or", "with", "into",
    ];
    title
        .split_whitespace()
        .map(|word| {
            ascii_fold(word)
                .chars()
                .filter(|c| c.is_ascii_alphanumeric())
                .collect::<String>()
                .to_lowercase()
        })
        .find(|word| !word.is_empty() && !SKIP.contains(&word.as_str()))
        .unwrap_or_default()
}

/// Fold the Latin-1 range down to ASCII.
///
/// Citation keys are used in `\cite{...}` and must survive every LaTeX engine
/// and every editor's idea of encoding. `Müller` becomes `mueller`, following
/// German transliteration rather than dropping the diaeresis, because
/// `muller` is a different name.
fn ascii_fold(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for c in input.chars() {
        match c {
            'ä' => out.push_str("ae"),
            'ö' => out.push_str("oe"),
            'ü' => out.push_str("ue"),
            'Ä' => out.push_str("Ae"),
            'Ö' => out.push_str("Oe"),
            'Ü' => out.push_str("Ue"),
            'ß' => out.push_str("ss"),
            'å' => out.push('a'),
            'æ' => out.push_str("ae"),
            'ø' => out.push('o'),
            'á' | 'à' | 'â' | 'ã' => out.push('a'),
            'é' | 'è' | 'ê' | 'ë' => out.push('e'),
            'í' | 'ì' | 'î' | 'ï' => out.push('i'),
            'ó' | 'ò' | 'ô' | 'õ' => out.push('o'),
            'ú' | 'ù' | 'û' => out.push('u'),
            'ç' => out.push('c'),
            'ñ' => out.push('n'),
            'ý' | 'ÿ' => out.push('y'),
            'ł' => out.push('l'),
            'š' => out.push('s'),
            'ž' => out.push('z'),
            'č' => out.push('c'),
            'ř' => out.push('r'),
            other => out.push(other),
        }
    }
    out
}

/// Map a Zotero item type onto a BibTeX entry type.
///
/// Unknown types become `@misc`, which every style can render. Inventing an
/// entry type no `.bst` recognises produces a silently missing bibliography
/// entry, which is worse than an imprecise one.
fn entry_type(item_type: &str) -> &'static str {
    match item_type {
        "journalArticle" | "magazineArticle" | "newspaperArticle" => "article",
        "book" => "book",
        "bookSection" => "incollection",
        "conferencePaper" => "inproceedings",
        "thesis" => "phdthesis",
        "report" | "standard" => "techreport",
        "manuscript" | "preprint" => "unpublished",
        "webpage" | "blogPost" => "online",
        _ => "misc",
    }
}

/// Escape the characters that are syntax in BibTeX and LaTeX.
///
/// A `&` or `%` copied out of a title will otherwise break the build — `%`
/// comments out the rest of the line, which is a particularly confusing failure
/// because the entry looks fine in the file.
fn escape(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for c in value.chars() {
        match c {
            '&' | '%' | '$' | '#' | '_' => {
                out.push('\\');
                out.push(c);
            }
            '{' | '}' => {
                out.push('\\');
                out.push(c);
            }
            '~' => out.push_str("\\textasciitilde{}"),
            '^' => out.push_str("\\textasciicircum{}"),
            '\\' => out.push_str("\\textbackslash{}"),
            other => out.push(other),
        }
    }
    out
}

/// Render an item as a BibTeX entry.
///
/// The title is wrapped in an extra pair of braces so that styles which
/// lowercase titles leave acronyms alone. `BIM and IFC` becoming `Bim and ifc`
/// is the classic complaint, and this is the classic fix.
pub fn to_bibtex(item: &Item, key: &str) -> String {
    let mut out = format!("@{}{{{},\n", entry_type(&item.item_type), key);

    if !item.title.is_empty() {
        out.push_str(&format!("  title = {{{{{}}}}},\n", escape(&item.title)));
    }
    if !item.creators.is_empty() {
        // BibTeX joins authors with " and ", and the `Last, First` form each
        // creator already carries is exactly what it expects.
        let authors = item
            .creators
            .iter()
            .map(|c| escape(c))
            .collect::<Vec<_>>()
            .join(" and ");
        out.push_str(&format!("  author = {{{authors}}},\n"));
    }
    if let Some(year) = item.year {
        out.push_str(&format!("  year = {{{year}}},\n"));
    }
    if let Some(container) = &item.container {
        let field = match entry_type(&item.item_type) {
            "inproceedings" | "incollection" => "booktitle",
            _ => "journal",
        };
        out.push_str(&format!("  {field} = {{{}}},\n", escape(container)));
    }
    if let Some(doi) = &item.doi {
        out.push_str(&format!("  doi = {{{}}},\n", escape(doi)));
    }

    out.push_str("}\n");
    out
}

/// Citation keys already present in a `.bib` file.
///
/// Deliberately tolerant. This parses only far enough to find keys, because its
/// job is to avoid colliding with them — a `.bib` this cannot fully parse is
/// still a `.bib` whose keys must be respected.
pub fn existing_keys(bib: &str) -> HashSet<String> {
    let mut keys = HashSet::new();
    for line in bib.lines() {
        let line = line.trim_start();
        let Some(rest) = line.strip_prefix('@') else {
            continue;
        };
        let Some((_, after_brace)) = rest.split_once('{') else {
            continue;
        };
        let key = after_brace.split(',').next().unwrap_or("").trim();
        if !key.is_empty() && !key.contains(char::is_whitespace) {
            keys.insert(key.to_owned());
        }
    }
    keys
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(creators: &[&str], year: Option<i32>, title: &str) -> Item {
        Item {
            key: "K".into(),
            citation_key: None,
            item_type: "journalArticle".into(),
            title: title.into(),
            creators: creators.iter().map(|c| (*c).to_owned()).collect(),
            year,
            container: None,
            doi: None,
        }
    }

    #[test]
    fn key_follows_the_surname_year_word_shape() {
        let it = item(
            &["Hagedorn, Jakob"],
            Some(2024),
            "Semantic validation of information containers",
        );
        assert_eq!(generate_key(&it), "hagedorn2024semantic");
    }

    #[test]
    fn leading_articles_do_not_become_the_key_word() {
        // `smith2024the` would be useless.
        let it = item(&["Smith, Jo"], Some(2024), "The bridge design guideline");
        assert_eq!(generate_key(&it), "smith2024bridge");
        let it = item(&["Smith, Jo"], Some(2024), "On the origin of species");
        assert_eq!(generate_key(&it), "smith2024origin");
    }

    #[test]
    fn german_umlauts_transliterate_rather_than_drop() {
        // `muller` is a different name from `mueller`.
        let it = item(&["Müller, Anna"], Some(2020), "Über Brücken");
        assert_eq!(generate_key(&it), "mueller2020ueber");
        let it = item(&["Weiß, Karl"], Some(2020), "Straßenbau");
        assert_eq!(generate_key(&it), "weiss2020strassenbau");
    }

    #[test]
    fn missing_author_and_year_still_produce_a_usable_key() {
        let it = item(&[], None, "Anonymous report");
        assert_eq!(generate_key(&it), "anonndanonymous");
        // And it must never be empty, or `\cite{}` results.
        assert!(!generate_key(&item(&[], None, "")).is_empty());
    }

    #[test]
    fn institutional_authors_keep_their_whole_name() {
        let it = item(&["European Commission"], Some(2019), "Level(s) framework");
        // No comma, so the whole name is the surname part.
        assert_eq!(generate_key(&it), "europeancommission2019levels");
    }

    #[test]
    fn colliding_keys_get_letter_suffixes() {
        let mut taken = HashSet::new();
        assert_eq!(disambiguate("smith2024bridge", &taken), "smith2024bridge");
        taken.insert("smith2024bridge".to_owned());
        assert_eq!(disambiguate("smith2024bridge", &taken), "smith2024bridgea");
        taken.insert("smith2024bridgea".to_owned());
        assert_eq!(disambiguate("smith2024bridge", &taken), "smith2024bridgeb");
    }

    #[test]
    fn disambiguation_never_returns_a_duplicate() {
        let mut taken: HashSet<String> = HashSet::new();
        taken.insert("k".to_owned());
        for suffix in b'a'..=b'z' {
            taken.insert(format!("k{}", suffix as char));
        }
        let result = disambiguate("k", &taken);
        assert!(!taken.contains(&result), "returned an already-used key");
    }

    #[test]
    fn latex_syntax_in_a_title_is_escaped() {
        // A `%` would comment out the rest of the line and the entry would look
        // perfectly fine in the file while breaking the build.
        let it = item(&["A, B"], Some(2024), "Cost & risk: 50% of the _total_");
        let bib = to_bibtex(&it, "ab2024cost");
        assert!(bib.contains("\\&"), "{bib}");
        assert!(bib.contains("\\%"), "{bib}");
        assert!(bib.contains("\\_"), "{bib}");
    }

    #[test]
    fn titles_are_brace_protected_so_acronyms_survive() {
        let it = item(&["Du, X"], Some(2024), "BIM and IFC data readiness");
        let bib = to_bibtex(&it, "du2024bim");
        assert!(
            bib.contains("title = {{BIM and IFC data readiness}}"),
            "acronyms must not be lowercased by the style: {bib}"
        );
    }

    #[test]
    fn authors_are_joined_the_way_bibtex_expects() {
        let it = item(&["Du, X", "Hou, Y", "Zhang, Z"], Some(2024), "T");
        let bib = to_bibtex(&it, "k");
        assert!(
            bib.contains("author = {Du, X and Hou, Y and Zhang, Z}"),
            "{bib}"
        );
    }

    #[test]
    fn container_maps_to_booktitle_for_proceedings() {
        let mut it = item(&["A, B"], Some(2024), "T");
        it.container = Some("Proceedings of Something".into());
        it.item_type = "conferencePaper".into();
        let bib = to_bibtex(&it, "k");
        assert!(bib.starts_with("@inproceedings{k,"), "{bib}");
        assert!(
            bib.contains("booktitle = {Proceedings of Something}"),
            "{bib}"
        );

        it.item_type = "journalArticle".into();
        assert!(to_bibtex(&it, "k").contains("journal = {"));
    }

    #[test]
    fn unknown_item_types_fall_back_to_misc() {
        let mut it = item(&["A, B"], Some(2024), "T");
        it.item_type = "somethingZoteroAddedLater".into();
        assert!(to_bibtex(&it, "k").starts_with("@misc{k,"));
    }

    #[test]
    fn existing_keys_are_read_out_of_a_bib_file() {
        let bib = "\
@article{hagedorn2024semantic,
  title = {{A}},
}

% a comment
@inproceedings{du2024bim,
  title = {{B}},
}
";
        let keys = existing_keys(bib);
        assert!(keys.contains("hagedorn2024semantic"));
        assert!(keys.contains("du2024bim"));
        assert_eq!(keys.len(), 2);
    }

    #[test]
    fn a_generated_entry_round_trips_through_the_key_reader() {
        // The entry we write must be one we can later recognise, or every
        // insertion would collide with itself.
        let it = item(&["Hagedorn, Jakob"], Some(2024), "Semantic validation");
        let key = generate_key(&it);
        let keys = existing_keys(&to_bibtex(&it, &key));
        assert!(
            keys.contains(&key),
            "wrote {key} but could not read it back"
        );
    }
}
