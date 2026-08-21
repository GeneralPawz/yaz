//! Reading the SyncTeX database, to get from a place in the PDF back to a
//! place in the source.
//!
//! # Why this is written here rather than linked
//!
//! SyncTeX ships a C library, and both TeX Live and MiKTeX install a
//! `synctex` command that answers exactly this question. Neither is used.
//!
//! The command is not available at all when yaz compiles with the embedded
//! engine, which is the configuration that needs no TeX distribution
//! installed — so a feature built on it would work only for people who did not
//! need the embedded engine in the first place. And the library is a C
//! dependency, which [ADR-0014](https://generalpawz.github.io/yaz/adr/0014-target-platforms-and-arm64)
//! makes a question about aarch64 rather than a detail.
//!
//! The format is a few kilobytes of line-oriented text. Reading it here costs
//! less than either alternative and works everywhere.
//!
//! # The format, as far as this needs it
//!
//! A preamble naming the input files by tag, then `Content:`, then a record per
//! line inside `{page … }` blocks:
//!
//! ```text
//! Input:1:/path/to/paper.tex
//! Magnification:1000
//! Unit:1
//! X Offset:0
//! Y Offset:0
//! Content:
//! {1
//! [1,9:4736286,49328947:30785865,44592661,0
//! (1,7:4736286,5522718:30785865,546132,0
//! g1,5:6724737,5522718
//! )
//! ]
//! }1
//! ```
//!
//! `[`/`]` open and close a vertical box, `(`/`)` a horizontal one, and the
//! single-letter records are the material inside: `g` glue, `k` kern, `$`
//! mathematics, `x` a position marker, `h`/`v` a void box. Each carries the
//! file tag and source line it came from, then its position, then its size.
//!
//! Positions are in scaled points measured from the **top left** of the page —
//! 65536 to the TeX point, 72.27 TeX points to the inch. A PDF point is 1/72
//! inch, so a coordinate in the PDF converts by
//! `sp = pt * 65536 * 72.27 / 72`. That constant is not a guess: it is what
//! reproduces a one-inch margin as the 4736286 that pdfTeX writes.

use std::collections::HashMap;
use std::io::Read;

use camino::{Utf8Path, Utf8PathBuf};

use yaz_core::{Error, Result};

/// Scaled points per PDF point.
///
/// 65536 scaled points to the TeX point, and 72.27 TeX points to the inch
/// against the PDF's 72.
const SP_PER_PDF_POINT: f64 = 65536.0 * 72.27 / 72.0;

/// A place in the source, as SyncTeX knows it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Location {
    /// The file, exactly as the engine recorded it.
    pub file: Utf8PathBuf,
    /// One-based line number.
    pub line: u32,
}

/// What kind of thing a record describes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    /// A box: `[`, `(`, or a void `h`/`v`. Has an extent.
    Box,
    /// Material inside a box: glue, kern, mathematics.
    Leaf,
    /// A position marker (`x`).
    ///
    /// Skipped when choosing which piece of a line was clicked. These mark
    /// where TeX's position tracking was asked a question, not where the
    /// author's words are, and preferring them lands the cursor on the line
    /// that ended the paragraph rather than the line that was clicked.
    Marker,
}

/// One record from the file.
#[derive(Debug, Clone)]
struct Record {
    tag: u32,
    line: u32,
    /// Horizontal position, in scaled points from the left edge.
    h: f64,
    /// Vertical position, in scaled points from the top edge. This is the
    /// baseline, which is not the top: type sits above its baseline.
    v: f64,
    width: f64,
    /// How far the box reaches above its baseline.
    height: f64,
    /// How far it reaches below.
    depth: f64,
    kind: Kind,
    /// Index of the enclosing box, if any.
    parent: Option<usize>,
}

/// A parsed SyncTeX database.
#[derive(Debug, Default)]
pub struct SyncTex {
    inputs: HashMap<u32, Utf8PathBuf>,
    pages: HashMap<u32, Vec<Record>>,
    /// Scale applied to every recorded coordinate.
    unit: f64,
    x_offset: f64,
    y_offset: f64,
}

impl SyncTex {
    /// Read a `.synctex` or `.synctex.gz`.
    ///
    /// Which one is decided by the content, not the name: `latexmk` and a bare
    /// engine invocation disagree about whether to compress, and a file called
    /// `.gz` that is not one should be read rather than refused.
    pub fn load(path: &Utf8Path) -> Result<Self> {
        let raw = std::fs::read(path).map_err(|source| Error::Io {
            path: path.to_owned(),
            source,
        })?;
        Self::parse(&decompress(&raw, path)?)
    }

    /// Parse the text of a database.
    pub fn parse(text: &str) -> Result<Self> {
        let mut synctex = SyncTex {
            unit: 1.0,
            ..SyncTex::default()
        };
        // The stack of boxes currently open, as indices into the page's
        // records. This is what gives every record its parent, and a parent is
        // what makes "the material inside the thing that was clicked"
        // answerable.
        let mut open: Vec<usize> = Vec::new();
        let mut page: Option<u32> = None;
        let mut records: Vec<Record> = Vec::new();

        for line in text.lines() {
            if let Some(rest) = line.strip_prefix("Input:") {
                if let Some((tag, path)) = rest.split_once(':') {
                    if let Ok(tag) = tag.trim().parse::<u32>() {
                        synctex.inputs.insert(tag, Utf8PathBuf::from(path.trim()));
                    }
                }
                continue;
            }
            if let Some(rest) = line.strip_prefix("Unit:") {
                if let Ok(value) = rest.trim().parse::<f64>() {
                    if value > 0.0 {
                        synctex.unit = value;
                    }
                }
                continue;
            }
            if let Some(rest) = line.strip_prefix("X Offset:") {
                synctex.x_offset = rest.trim().parse().unwrap_or(0.0);
                continue;
            }
            if let Some(rest) = line.strip_prefix("Y Offset:") {
                synctex.y_offset = rest.trim().parse().unwrap_or(0.0);
                continue;
            }

            let Some(first) = line.chars().next() else {
                continue;
            };
            match first {
                '{' => {
                    page = line[1..].trim().parse::<u32>().ok();
                    records = Vec::new();
                    open.clear();
                }
                '}' => {
                    if let Some(number) = page.take() {
                        synctex.pages.insert(number, std::mem::take(&mut records));
                    }
                    open.clear();
                }
                '[' | '(' if page.is_some() => {
                    if let Some(record) = parse_record(&line[1..], Kind::Box, open.last().copied())
                    {
                        open.push(records.len());
                        records.push(record);
                    }
                }
                ']' | ')' => {
                    open.pop();
                }
                'h' | 'v' | 'g' | 'k' | '$' | 'x' | '<' | '>' if page.is_some() => {
                    // A void box still has an extent; the rest are points.
                    let kind = match first {
                        'h' | 'v' | '<' | '>' => Kind::Box,
                        'x' => Kind::Marker,
                        _ => Kind::Leaf,
                    };
                    if let Some(record) = parse_record(&line[1..], kind, open.last().copied()) {
                        records.push(record);
                    }
                }
                // `!` is a byte count, `f` a form reference, `Postamble:` the
                // end. None of them position anything.
                _ => {}
            }
        }

        // A database with no pages is not an error: a compile that failed
        // before shipping a page writes one, and the caller's question simply
        // has no answer.
        Ok(synctex)
    }

    /// The source location for a point in the PDF.
    ///
    /// `page` is one-based; `x` and `y` are PDF points measured from the top
    /// left corner of that page, which is what a viewer has after converting a
    /// click through its own transform.
    ///
    /// # How the record is chosen
    ///
    /// Nearest first, then more specific. The closest record is the one
    /// minimising its vertical distance from the point plus its horizontal
    /// distance from the point — vertical measured to the baseline, because
    /// that is what a line of type is, and horizontal measured to the whole
    /// extent, because a line of type is wide.
    ///
    /// If that record turns out to be a box, the material directly inside it
    /// is consulted for a better line: a paragraph's box carries the line where
    /// the paragraph *ended*, while the glue between its words carries the line
    /// each word came from. Only the material directly inside, never deeper —
    /// descending further would answer with a line from some other paragraph
    /// when the click landed in the space between them.
    pub fn locate(&self, page: u32, x: f64, y: f64) -> Option<Location> {
        let records = self.pages.get(&page)?;
        let h = (x * SP_PER_PDF_POINT - self.x_offset) / self.unit;
        let v = (y * SP_PER_PDF_POINT - self.y_offset) / self.unit;

        // Descend the tree of boxes rather than ranking every record at once.
        // Every box enclosing the point is equally close to it — the page's own
        // box included — so a flat search answers with whichever line closed
        // the page. Walking down, taking the nearest box at each level, ends at
        // the line of type nearest the click.
        let mut current: Option<usize> = None;
        while let Some(next) = self.nearest(records, current, Kind::Box, h, v) {
            current = Some(next);
        }

        // A paragraph's box carries the line where the paragraph *ended*, while
        // the glue between its words carries the line each word came from. So
        // the material directly inside the box that was reached gives a better
        // answer than the box itself, when there is any.
        let refined = self
            .nearest(records, current, Kind::Leaf, h, v)
            .or(current)?;

        Some(Location {
            file: self.inputs.get(&records[refined].tag)?.clone(),
            line: records[refined].line,
        })
    }

    /// The child of `parent` of the given kind that is nearest the point.
    fn nearest(
        &self,
        records: &[Record],
        parent: Option<usize>,
        kind: Kind,
        h: f64,
        v: f64,
    ) -> Option<usize> {
        records
            .iter()
            .enumerate()
            .filter(|(_, record)| record.parent == parent && record.kind == kind)
            .min_by(|a, b| a.1.distance(h, v).total_cmp(&b.1.distance(h, v)))
            .map(|(index, _)| index)
    }

    /// The files the document was built from, by tag.
    pub fn inputs(&self) -> impl Iterator<Item = &Utf8Path> {
        self.inputs.values().map(Utf8PathBuf::as_path)
    }
}

impl Record {
    /// How far the point is from this record.
    ///
    /// Measured to the record's *extent*, not to its reference point, and this
    /// is the detail the whole thing turns on. A line of type occupies the
    /// band from `v - height` to `v + depth`; its baseline sits at the bottom
    /// of the letters, not through the middle of them. Measuring to the
    /// baseline puts a click on the upper half of a word nearer to the line
    /// above it, so nearly every click in running prose answers one line
    /// early — which is exactly what it did before this was measured against
    /// the reference implementation.
    fn distance(&self, h: f64, v: f64) -> f64 {
        distance_to(h, self.h, self.h + self.width)
            + distance_to(v, self.v - self.height, self.v + self.depth)
    }
}

/// How far a coordinate lies outside an interval; zero inside it.
fn distance_to(value: f64, low: f64, high: f64) -> f64 {
    if value < low {
        low - value
    } else if value > high {
        value - high
    } else {
        0.0
    }
}

/// Read `tag,line:h,v` and whatever size follows.
fn parse_record(body: &str, kind: Kind, parent: Option<usize>) -> Option<Record> {
    let mut fields = body.split(':');
    let (tag, line) = fields.next()?.split_once(',')?;
    // A record may carry `line,column`; the column is not recorded reliably by
    // any engine, and nothing here uses it.
    let line = line.split(',').next()?;
    let (h, v) = fields.next()?.split_once(',')?;

    // `width,height,depth` for a box, absent for a point, and a lone width for
    // a kern.
    let mut size = fields
        .next()
        .unwrap_or("")
        .split(',')
        .map(|value| value.trim().parse::<f64>().unwrap_or(0.0));
    let width = size.next().unwrap_or(0.0);
    let height = size.next().unwrap_or(0.0);
    let depth = size.next().unwrap_or(0.0);

    Some(Record {
        tag: tag.trim().parse().ok()?,
        line: line.trim().parse().ok()?,
        h: h.trim().parse().ok()?,
        v: v.trim().parse().ok()?,
        // A negative extent would run backwards and make the distance to it
        // meaningless. TeX writes them for boxes that have been shifted.
        width: width.max(0.0),
        height: height.max(0.0),
        depth: depth.max(0.0),
        kind,
        parent,
    })
}

/// Decompress if it is gzip, and read as text either way.
fn decompress(raw: &[u8], path: &Utf8Path) -> Result<String> {
    let bytes = if raw.starts_with(&[0x1f, 0x8b]) {
        let mut out = Vec::new();
        flate2::read::GzDecoder::new(raw)
            .read_to_end(&mut out)
            .map_err(|source| Error::Io {
                path: path.to_owned(),
                source,
            })?;
        out
    } else {
        raw.to_vec()
    };

    // The paths in the preamble come from the filesystem and need not be
    // UTF-8. Losing a character from a package path is better than refusing to
    // answer, since the file that matters is the one being edited.
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}
