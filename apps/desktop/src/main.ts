import { mount } from "svelte";

// The token contract first, then the active theme, then component styles.
// Themes are injected after core styles and before plugin styles (ADR-0010), so
// a plugin can style its own UI in terms of the tokens and inherit whatever
// theme is active.
import "../../../themes/tokens.css";
import "../../../themes/yaz-dark/theme.css";
import "./app.css";

// KaTeX ships its own stylesheet and fonts, which the rich-text view needs in
// order to typeset mathematics (ADR-0004). Bundled, never fetched: the app has
// to work with no network at all.
import "katex/dist/katex.min.css";

import App from "./App.svelte";

const target = document.getElementById("app");
if (!target) throw new Error("missing #app mount point");

export default mount(App, { target });
