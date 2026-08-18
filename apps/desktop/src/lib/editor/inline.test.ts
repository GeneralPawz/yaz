/**
 * Rendering a fragment of LaTeX to HTML.
 *
 * The escaping cases are the point. This output goes into a widget through
 * `innerHTML`, and the input is whatever is in the author's document — which
 * may have come from a template, a co-author or a download.
 */

import { describe, expect, it } from "vitest";

import { escapeHtml, inlineHtml } from "./inline";

describe("escapeHtml", () => {
  it("neutralises markup", () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
    );
  });
});

describe("inlineHtml", () => {
  it("escapes text from the document", () => {
    // A cell holding `<b>` is a document that contains those characters, not a
    // document that wants bold text.
    expect(inlineHtml("a <b> c")).toBe("a &lt;b&gt; c");
  });

  it("wraps the commands it knows", () => {
    expect(inlineHtml("\\textbf{a}")).toBe("<strong>a</strong>");
    expect(inlineHtml("\\emph{a}")).toBe("<em>a</em>");
    expect(inlineHtml("\\texttt{a}")).toBe("<code>a</code>");
  });

  it("nests them", () => {
    expect(inlineHtml("\\textbf{very \\emph{good}}")).toBe(
      "<strong>very <em>good</em></strong>",
    );
  });

  it("keeps the words of a command it does not know", () => {
    expect(inlineHtml("\\textcolor{red}")).toBe("red");
    expect(inlineHtml("\\somemacro{words here}")).toBe("words here");
  });

  it("keeps escaped characters as themselves", () => {
    expect(inlineHtml("50\\% of \\$5")).toBe("50% of $5");
    expect(inlineHtml("Smith \\& Jones")).toBe("Smith &amp; Jones");
  });

  it("typesets mathematics", () => {
    expect(inlineHtml("$x^2$")).toContain("katex");
  });

  it("leaves mathematics it cannot typeset as source", () => {
    expect(inlineHtml("$\\frac{1$")).toBe("$\\frac{1$");
  });

  it("does not let a formula smuggle markup through", () => {
    // KaTeX output is trusted because KaTeX produced it. What it refuses is
    // not, and goes back through escaping.
    expect(inlineHtml("$<img src=x onerror=1>$")).not.toContain("<img");
  });
});
