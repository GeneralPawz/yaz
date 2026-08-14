# 0019 — TLS trust: bundled roots or the operating system store

- **Status:** Accepted
- **Date:** 2026-08-14

## Context

yaz makes HTTPS requests for three things: the Zotero bridge
([0008](0008-zotero-integration.md)), the plugin registry and plugin downloads
([0013](0013-update-distribution.md)), and application update checks. Every one
has to decide which certificate authorities to trust.

Today the application uses `reqwest` with the `rustls-tls` feature, which means
**rustls verifying against `webpki-roots`** — Mozilla's root list compiled into
the binary. That was not a considered decision; it is reqwest's default for that
feature, and it deserves one.

What makes this more than a detail is the audience. Academic and corporate
networks very commonly run TLS-intercepting middleboxes, which work by installing
a custom root CA into the **operating system** trust store. Software that carries
its own roots does not see that CA, so every HTTPS request fails — and it fails
only for users behind such a network, which is a population we cannot reproduce
locally and which substantially overlaps our target users.

## The options

Both are already present in the dependency graph. `rustls-native-certs 0.8.4` and
`rustls-platform-verifier 0.7.0` are locked today alongside `webpki-roots 1.0.9`,
so this is a feature selection rather than a new dependency, and it is
reversible.

### A — Bundled roots (`rustls-tls`, the current state)

**For**

- **Deterministic.** Every machine makes identical trust decisions, so a TLS
  failure in CI reproduces on a developer's laptop. With OS roots the deciding
  variable is invisible and differs per machine.
- **Immune to a broken or outdated OS store.** An old or unpatched system still
  gets a current, correct root set.
- **One code path** across Windows, Linux and eventually macOS.
- **Faster startup**: no enumerating and parsing hundreds of system certificates.

**Against**

- **Fails completely behind a TLS-intercepting proxy.** This is the decisive
  objection. Zotero sync, the plugin registry and update checks all break, for
  exactly the users we are building for.
- **Ignores administrator policy**, including *removals*. If an institution
  distrusts a CA, we keep trusting it — which is a security argument against
  bundling, not for it.
- **Roots update on our release cadence**, not the OS's. A compromised CA stays
  trusted until we ship.
- Users cannot add a root for a self-hosted Zotero or Git server.

### B — Operating system trust store (`rustls-tls-native-roots`)

**For**

- **Works on a university or corporate network.** The whole point.
- **Honours administrator policy**, additions and removals alike.
- **Roots update with the OS**, independently of us.
- Users can trust their own internal services without us building anything.

**Against**

- **Non-deterministic across machines.** "Works on mine" becomes a real category
  of bug, and the differing variable is not visible in the repository.
- **Platform variation**, particularly on Linux where the store location differs
  by distribution and may be absent entirely in a minimal container.
- Slower startup by the cost of reading the store.

### C — Platform TLS entirely (`native-tls`)

Schannel on Windows, Secure Transport on macOS, OpenSSL on Linux. Gets the OS
store as a side effect.

**Rejected.** It adds an OpenSSL dependency on Linux — a system library and a C
build we currently do not need, since rustls is pure Rust — for no benefit over
option B, which reaches the same trust store without it.

## What settles it

The obvious counter-argument to option B is "the OS store is less trustworthy,
and updates are security-critical, so bundle the roots we vouch for."

That argument does not survive contact with
[ADR-0013](0013-update-distribution.md): **update artefacts are signed with
minisign and the public key is compiled into the application.** Artefact
authenticity does not depend on TLS at all — TLS is only transport there. An
intercepting proxy that can decrypt our update traffic still cannot substitute an
artefact.

So our single most security-sensitive network operation is unaffected by this
choice, which removes the main reason to prefer bundled roots. What remains on
that side is determinism, which is a debugging convenience, against connectivity,
which is whether the product works at all for a large share of its users.

## Decision

**Option B: the platform store, with the bundled set as a fallback when it is
empty or unreadable.**

Keeps rustls — pure Rust, no OpenSSL on Linux, no new C dependency — while
sourcing roots from the OS. The fallback matters for minimal Linux containers,
where the store may genuinely not exist and failing closed would be worse than
using Mozilla's list.

The determinism loss is real but bounded: when a TLS failure is suspected, it can
be diagnosed by comparing against the bundled set, and the failure mode is a
connection error rather than silent acceptance of a bad certificate.

### It is not enough to enable both features

Worth stating, because it is the obvious implementation and it is wrong.
`reqwest` treats each root source independently and merges them, so switching on
both `rustls-tls-native-roots` and `rustls-tls-webpki-roots` produces a client
trusting the **union** of the OS store and Mozilla's list.

That looks like a harmless superset and quietly destroys half of what this ADR is
for: a CA the administrator *removed* would still be trusted through the bundled
copy, so institutional policy is not honoured after all.

Both are therefore compiled in, and exactly one is switched on per client —
`tls_built_in_native_certs` and `tls_built_in_webpki_certs` set to opposite
values, decided by probing whether the platform store returned any usable roots.

### One implementation, in one place

Every HTTP client in the application is built by `yaz_core::net::http_client`.
A caller reaching for `reqwest::Client::new` gets reqwest's defaults and a
different set of roots to the rest of the application, and the divergence would
only show up on a user's network — which is precisely where it cannot be
debugged.

The selected source is reported at startup (`tls_roots="platform"`) and is
available as `yaz_core::net::trust_roots`, because a TLS bug report is not
reproducible without it.

## Consequences

- Zotero sync, plugin installation and update checks work behind institutional
  TLS interception, which is where much of the intended audience sits.
- Institutional CA policy is honoured, including distrusted authorities.
- Trust decisions become machine-dependent. A TLS bug report needs the platform
  and the store contents to be reproducible, so the diagnostics must say which
  root source was used.
- One more platform-specific behaviour to test. The Linux fallback path in
  particular needs a test that exercises an empty store.
- Reversible: it is a feature selection, and both root sources are already in the
  dependency graph.

## Alternatives considered

**Leave it as it is.** Defensible only if we assume users are on unfiltered
networks. That assumption is wrong for universities, hospitals and most large
employers.

**Make it configurable.** A setting to choose the root source, or to add a
custom CA. Rejected as premature: it asks a question most users cannot answer,
and option B already covers the case a custom CA would solve, since an
administrator installing one puts it in the OS store anyway. Worth revisiting
only if a concrete case appears that the OS store does not cover.

**Pin certificates for known hosts.** Strongest against interception, and
actively wrong here: it would *break* the legitimate corporate proxies this ADR
exists to accommodate.
