# 0022 — MCP: calling out is a capability, exposing tools is a declaration

- **Status:** Accepted
- **Date:** 2026-08-20
- **Supersedes:** —
- **Superseded by:** —

## Context

yaz should speak MCP in both directions. It should be able to _use_ MCP servers
— a reference checker, a style tool, whatever someone runs — and it should
_be_ an MCP server, so that an agent can drive it: open a project, read the
outline, compile, tell me what broke.

The second direction is the interesting one for the plugin system, because a
plugin will want to add tools to it. The Zotero plugin knows how to search a
library; that is obviously a tool an agent should be able to call. So plugins
need a way to contribute tools, and the question is what that contribution
_is_: a capability the broker grants, or something else.

It matters more than a naming argument, because a future registry has to be
able to answer "what does this plugin do to my machine, and what does it add to
yaz" from the manifest alone, without running anything.

## Decision

**They are two different things and they get two different fields.**

### Calling an MCP server is a capability

A plugin reaching out to an MCP server is reaching outside the process, to
something the user did not necessarily set up or expect. That is a permission,
and it belongs exactly where `net` and `process` belong:

```json
"capabilities": [{ "kind": "mcp-client", "servers": ["reference-checker"] }]
```

Named servers, not "MCP". A capability that grants _any_ server is not a
capability, for the same reason
[ADR-0006](0006-plugin-runtime-and-capabilities.md) rejects a wildcard host.

### Contributing a tool is a declaration, not a capability

A plugin adding a tool to yaz's own MCP server is **not** asking for a
permission, and modelling it as one would be security theatre — it would look
like a grant while granting nothing.

The reason is worth being precise about: **a contributed tool cannot do
anything the plugin could not already do.** It runs inside the plugin, through
the same API, bounded by the same capabilities. A tool that reads the project
needs `fs-project` _and the plugin already had to declare it_. Adding a second
gate in front of the first would not narrow anything.

So contributing is a contribution, like `addCommand` or `registerFormat`.
Nobody asks permission to add a command.

### But it is still declared in the manifest, and the declaration is checked

```json
"provides": {
  "tools": [
    { "name": "search-library", "descriptionKey": "zotero-tool-search" },
    { "name": "cite-item", "descriptionKey": "zotero-tool-cite" }
  ]
}
```

Two reasons, and the second is what makes it worth the field:

**It has to be readable without running the plugin.** "This plugin exposes two
tools an external agent can call" is something a person should see _before_
installing and a registry should be able to list from the manifest alone. A
fact only discoverable by executing the code is a fact a registry cannot show.

**And yaz refuses to register a tool the manifest did not declare.** That is
what stops the field being a comment. A manifest entry nothing checks drifts
out of date within one release and then actively misleads — which is worse than
not having it, because people trust it. Declared-and-verified is the same shape
capabilities already have, and it is the only shape that stays true.

### How an agent reaches it

The server listens on `127.0.0.1` on a port the operating system chooses, and
every request must carry a token generated when it starts. Not stdio, which is
how most MCP servers work: yaz is a window somebody already has open with a
project already loaded, and the whole point is to drive _that_ — a client that
spawned its own copy would get an editor with nothing in it.

Loopback is not a boundary by itself. Any local process can reach the port,
including a web page's JavaScript, which is the case worth designing against —
so the token does the work and the loopback bind only keeps an editor that can
write to your disk off the network.

## Consequences

**A plugin author writes the tool twice** — once in the manifest, once in the
code — and yaz complains if they disagree. Mildly annoying, and the entire
point: the manifest is what a stranger reads, so it is the manifest that has to
be right.

**A registry can be built later without changing any plugin.** Everything it
would need to list — capabilities requested, tools provided, update source — is
already static in the manifest by then. This is the same reasoning that let
[ADR-0021](0021-plugin-distribution.md) skip a registry for now.

**Tool names collide across plugins.** Namespaced by plugin id when exposed, so
two plugins may both provide `search` without either having to know about the
other.

**yaz being an MCP server is a security surface, and a real one.** An agent
that can drive the editor can write to the project. That is the point of it and
is also why it is off until switched on, and why what an agent may reach is the
union of what the _plugins_ were granted rather than everything the process
can do.

## Alternatives considered

**Make contributing a capability too.** Symmetrical, and dishonest: it would
appear in the same list as `fs-project` and `net` while granting nothing, which
teaches people that entries in that list do not mean much. The value of a
permission list is that every line of it is load-bearing.

**Declare nothing; let the code register whatever it likes.** Simplest, and it
gives up the thing a registry needs most — knowing what a plugin does before
running it. It also makes "which plugin added this tool" a runtime question.

**A separate `mcp.json` beside the manifest.** Cleaner separation, one more
file to find, and it splits "what this plugin is" across two places. The
manifest is already the answer to that question.
