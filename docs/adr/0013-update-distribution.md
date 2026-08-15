# 0013 — Update distribution for app and plugins, and dev-mode behaviour

- **Status:** Accepted
- **Date:** 2026-08-14

## Context

Three distribution problems, related but not identical:

- **The application** must update itself from GitHub releases, across four
  platform/architecture combinations.
- **Plugins and themes** must be installable from a GitHub repository _and_ from
  a local file, and updatable from their source repository.
- **Development must never touch any of this.** A developer running from source
  must not have the updater fetch a release over their build, must not hit the
  live plugin registry, and must not be able to accidentally publish.

An auto-updater is the most security-sensitive component in a desktop
application: it downloads code and runs it with the user's privileges. And
[0006](0006-plugin-runtime-and-capabilities.md) identified the specific attack an
updater enables — a plugin that is benign at install time requesting new
capabilities in an update.

## Decision

### Application updates

- **Tauri's updater**, with update manifests published to GitHub Releases.
- **Every artefact is signed with a minisign key, and the public key is compiled
  into the application.** An unsigned or badly-signed update is refused. The
  private key exists only as a CI secret and never on a developer machine.
- Per-target manifests for `windows-x86_64`, `windows-aarch64`,
  `linux-x86_64`, `linux-aarch64`. **An installation only ever sees updates for
  its own architecture** — an ARM64 install must never be offered an x86_64
  build ([0014](0014-target-platforms-and-arm64.md)).

- **…and only for its own variant.** Two builds ship per platform: `full`, with
  the LaTeX engine embedded, and `slim`, which uses a TeX distribution already on
  the machine ([0007](0007-latex-compilation-engines.md)). They share a product
  identifier, so nothing but the manifest keeps them apart.

  Crossing that line is not cosmetic. Updating a `full` installation to a `slim`
  build **silently removes the user's LaTeX engine**: projects that compiled
  yesterday stop compiling, with an error about a missing engine and no
  indication that an update caused it. Manifests are therefore keyed by variant
  as well as architecture, and the running binary knows which it is at compile
  time — `cfg!(feature = "tectonic-engine")` is the variant.

  The reverse direction, slim to full, is merely wasteful rather than harmful,
  but it is gated the same way: a user who chose the 3 MB download should not be
  handed a 14 MB one without asking.

- Update checks are **opt-in on first run**, with a clear explanation. Checking
  is a network request that reveals an install exists; the user decides.
- Release channels: `stable` and `beta`. A user opts into `beta` explicitly and
  can return to `stable`.
- The changelog for the pending version is shown _before_ the user accepts.

### Plugin and theme updates

- A manifest declares `id`, `version`, `minAppVersion`, `repository`, and
  `capabilities`.
- **From GitHub:** we query the releases API of the declared repository, download
  the release asset, and verify its checksum against the registry entry.
- **From file:** a `.zip` or a folder, installed directly. Sideloading is a
  first-class path — it is how authors test and how private plugins are
  distributed — and it carries a clear warning that nothing has been reviewed.
- The **community registry** is a separate `yaz-releases` repository holding a
  JSON index: id, repository, author, description, and known-good checksums.
  Listing there is a lightweight review, not a security guarantee, and the UI
  says so.
- **Plugin updates are opt-in per plugin**, off by default. A plugin auto-update
  is arbitrary code arriving unattended and should be a choice.
- **A plugin update requesting capabilities the installed version did not have
  is blocked until the user explicitly approves the new set.** This is the
  privilege-escalation defence promised in [0006](0006-plugin-runtime-and-capabilities.md).
- A plugin whose `minAppVersion` exceeds the running application is not offered.

### Development mode — explicitly

Determined by a debug build or `YAZ_DEV=1`, and shown in the window title so it
is never ambiguous:

| Behaviour         | Release                     | Dev                                       |
| ----------------- | --------------------------- | ----------------------------------------- |
| App update check  | Enabled (if opted in)       | **Never runs**                            |
| Plugin registry   | Live `yaz-releases`         | Local fixture at `.yaz-dev/registry.json` |
| Plugin source     | Installed plugins directory | Also loads unpacked from `dev-plugins/`   |
| Plugin hot reload | No                          | **Yes**, on file change                   |
| Signature checks  | Enforced                    | Enforced, against a dev key               |
| Telemetry         | N/A                         | N/A                                       |

Signature verification is **not** relaxed in dev. Disabling it in the code path
developers exercise daily is how it ends up disabled in a release build.

## Consequences

- Users get a normal, safe update experience; ARM users get ARM builds.
- Plugin authors iterate with hot reload and sideloading, without a registry.
- Signing key management becomes an operational responsibility with a real
  consequence: **losing the private key means no existing installation can ever
  be updated again.** It is backed up out of band, and key rotation is a
  documented procedure, not an improvisation.
- Four platform/architecture targets means the release workflow is a build
  matrix, and a release is not complete until all four artefacts and manifests
  exist. A partial release must not publish.
- Capability re-confirmation on update will occasionally annoy users. That is the
  correct trade.
- The dev/release split must be tested in both modes, or the dev path silently
  rots.
- Running the registry means moderating it, and we will eventually have to remove
  something malicious. A documented takedown path is required before the registry
  opens.

## Alternatives considered

**Package managers only** (winget, apt, Flatpak, AUR). Better OS integration and
no updater to maintain. Rejected as the _primary_ mechanism: coverage is uneven,
lag between our release and availability is long and out of our control, and
Linux ARM64 coverage is patchiest of all. We intend to publish there in addition.

**No auto-update; notify only.** Simplest and safest — no code download path at
all. Rejected because unpatched installations are themselves a security problem,
and users of a writing tool will not manually update it.

**A centralised plugin store we host.** Better review and revocation. Rejected on
cost and on principle: it makes us a gatekeeper and a single point of failure,
where the GitHub-plus-index model keeps authors in control of their releases.

**Unsigned updates over HTTPS.** Rejected outright. Transport security is not
artefact authenticity, and this is the one place where getting it wrong is
catastrophic.
