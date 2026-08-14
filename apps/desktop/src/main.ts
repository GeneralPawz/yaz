import { mount } from "svelte";

// The token contract first, then the active theme, then component styles.
// Themes are injected after core styles and before plugin styles (ADR-0010), so
// a plugin can style its own UI in terms of the tokens and inherit whatever
// theme is active.
import "../../../themes/tokens.css";
import "../../../themes/yaz-dark/theme.css";
import "./app.css";

import App from "./App.svelte";

const target = document.getElementById("app");
if (!target) throw new Error("missing #app mount point");

export default mount(App, { target });
