# Security policy

## Reporting a vulnerability

**Do not open a public issue.** Use GitHub's private vulnerability reporting on
this repository (Security → Report a vulnerability), which reaches the
maintainers directly.

Please include what you can: affected version and platform, reproduction steps,
and what an attacker gains. We will acknowledge within a few days and keep you
updated as we work on it. We are happy to credit you in the advisory unless you
prefer otherwise.

## What we consider a vulnerability

The security model is described in
[ADR-0006](docs/adr/0006-plugin-runtime-and-capabilities.md) and
[ADR-0013](docs/adr/0013-update-distribution.md). In scope, and treated
seriously:

- **Capability broker escapes.** A plugin reaching a file, host, or process
  outside its granted capabilities. Path traversal and symlink escape past
  canonicalisation belong here and are the highest-severity class.
- **Privilege escalation through updates.** A plugin update gaining capabilities
  the user did not approve.
- **Updater weaknesses.** Anything allowing an unsigned or substituted artefact
  to be installed, or an architecture mismatch being accepted.
- **Compilation escapes.** `--shell-escape` being enabled without explicit user
  opt-in, or a document achieving code execution through a path we control.
- **Data exfiltration** by a plugin without the `net` capability.

## What is *not* a vulnerability

Stated plainly, because being vague here would be worse than being unwelcome:

**A plugin sharing the webview DOM can read the open document, observe
keystrokes, and overlay interface elements. This is by design and is documented
in ADR-0006.** Capabilities constrain what leaves your machine and what touches
your disk; they do not isolate a plugin from the application's own interface. A
report demonstrating that an installed plugin can read the editor contents is
describing intended behaviour.

Consequently: **only install plugins you trust.** Restricted mode loads no
community plugins and exists for opening untrusted projects.

Also out of scope: issues requiring an already-compromised machine, and social
engineering of users into installing a malicious plugin — though we do want to
hear about anything that makes such a plugin's capabilities *misleading* in the
install dialog, since that undermines the one defence the user has.

## Supported versions

During pre-alpha, only the latest release is supported. This section will be
replaced with a proper support window at 1.0.
