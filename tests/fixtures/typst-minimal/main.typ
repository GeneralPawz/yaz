#set document(title: "A Minimal yaz Typst Document", author: "yaz")
#set page(paper: "a4", margin: 2.5cm)
#set text(size: 11pt)
#set heading(numbering: "1.")

= A Minimal yaz Document

This exists so the Typst engine has something small and boring to chew on. It
uses only what the standard library provides, so it compiles with the embedded
fonts and no downloaded packages.

== Some Mathematics

Euler's identity, to exercise maths layout:

$ e^(i pi) + 1 = 0 $

And an inline fragment, $alpha + beta = gamma$.

== A List

- Cross-references, to exercise multi-pass resolution: see @sec-maths.
- Mathematics, to exercise font selection.
- Nothing else.

== Referenced section <sec-maths>

Referenced by the list above.
