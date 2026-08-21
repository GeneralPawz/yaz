# 0024 — The page is a fixed box; content is pushed through it

- **Status:** Accepted
- **Date:** 2026-08-21
- **Supersedes:** —
- **Superseded by:** —

## Context

The page view shows a `.tex` file set on sheets of paper. Four attempts at it
all built the page **out of the content**: work out how many rows of text a
sheet holds, count the rows each line takes, break when the count runs out, and
pad the foot of a sheet that came up short.

Each attempt improved the count and none of them fixed the problem, because the
count was never the problem.

A page assembled from content can **stretch**. The padding at the foot only
helps a sheet that came up _short_; there is nothing that can shrink one that
ran over. So every under-estimate — an image that turned out to be four hundred
pixels tall, a glossary entry whose definition wrapped to three rows, a title
set in `\LARGE` — did not make its sheet slightly wrong. It made the sheet
_grow_, and a sheet that grows is not a sheet.

The reports were all the same shape and all had this cause: a title page twice
the height of the paper, a glossary spread over pages of four different
lengths, images stretching a sheet instead of moving to the next one, and pages
that changed length when the magnification changed.

Measuring the content instead of counting it made the estimate exact and did
not help, because an exact height still cannot shrink a page that is made of
the thing being measured.

## Decision

**Two halves, and only one of them decides where a page is.**

### The page is a fixed box

A sheet is painted behind the text as a repeating gradient: the paper's height,
then the gap, repeating. It is computed from the page size the author chose and
the magnification they are looking at, and it knows nothing whatever about the
content.

It therefore cannot stretch. Every sheet is exactly the same height as every
other sheet because they are the same gradient. There is no arrangement of text
that can change that, which is the property every earlier version lacked.

### Content is pushed through it

A view plugin measures where each block actually sits and, wherever one would
cross a sheet's bottom margin, inserts a gap of exactly the height needed to
carry it to the top of the next sheet.

Nothing is padded and nothing is estimated. The gap is the difference between
two measured numbers, and it only ever moves content _down_.

### Why that settles rather than oscillating

Inserting a gap moves everything below it, which changes what needs a gap. The
loop closes because every gap carries a block onto a sheet where it fits, so
each pass has strictly less to do than the last, and a block that has been
carried to the top of a sheet is never carried again.

A block taller than the usable page is the exception: it cannot be made to fit,
so it is left where it is and allowed to overflow — exactly as LaTeX leaves an
oversized image sticking off the paper.

## Consequences

- **A sheet is always the size of the paper.** Not usually, not when the
  estimate is good: always, because it is not made of anything that could
  change its size.
- **The page size is arithmetic, not measurement.** A4 is 297 mm whatever the
  font is doing. Measuring it was a bug of its own: the magnification is a CSS
  custom property, so reading a line height straight after changing it paired
  the old height with the new zoom, and every zoom step computed the wrong
  page.
- **What _is_ measured is how tall the content turned out**, which is the one
  thing only the browser knows.
- **Only what is on screen is paginated.** The rest of a hundred-page document
  has never been laid out and has no honest height; it keeps the gaps it had
  and is corrected before it is drawn.
- **The row bookkeeping is gone.** Recording how tall every line was drawn, how
  much of it was hidden and how many rows each widget stood for ran on every
  replacement in the document on every keystroke. Removing it took the
  decoration pass on a joined thesis from 14.9 ms to 13.0 ms.
- **A generated listing still divides itself**, because a gap cannot be put
  inside a widget. It is the only thing that still needs a row count, and it
  gets one measured rather than guessed.
- **The front matter no longer has a short sheet of its own.** Every sheet is
  the same height, so it takes a whole one. That is the price of the property
  above and it is worth paying.
