# 0018 — Licensing: AGPL-3.0 application, MIT plugin API

- **Status:** **Proposed** — requires the project owner's decision before the
  first external contribution is accepted.
- **Date:** 2026-08-14

## Context

**Licensing must be decided before contributors arrive.** Once third parties hold
copyright in the codebase, relicensing requires every one of their agreement, and
in practice that means it never happens. This is the most time-sensitive decision
in the ADR set, which is why it is recorded now rather than deferred.

Three distinct concerns pull differently:

1. **The application.** A local-first LaTeX editor with Overleaf-adjacent
   features. The realistic commercial risk is someone taking the codebase,
   wrapping it as a hosted service, and contributing nothing back.
2. **The plugin API.** Plugin authors must be able to license their plugins
   however they wish, including proprietary. A copyleft API package creates
   genuine uncertainty about whether linking against it infects the plugin — and
   uncertainty alone is enough to deter authors, regardless of the legal truth.
3. **Precedent in this space.** Zotero is AGPL-3.0 with a large plugin ecosystem,
   which demonstrates the combination works. Obsidian is proprietary. Overleaf
   is AGPL-3.0 for its community edition.

## Decision (proposed)

**Split licensing:**

| Component | Licence | Reasoning |
| --- | --- | --- |
| `crates/`, `apps/`, `plugins/` | **AGPL-3.0-or-later** | Improvements to the application return to the project, including from anyone hosting it as a service |
| `packages/api` (`@yaz/api`) | **MIT** | Plugin authors link against it and must be free to license their work as they choose, with no ambiguity |
| `packages/plugin-template` | **MIT** | A starter template must not dictate the licence of what is built from it |
| `docs/` | **CC BY-SA 4.0** | Prose, not code |

The AGPL network clause is doing real work here despite this being a desktop
application: it is what prevents a hosted Overleaf-style competitor built on this
code from keeping its changes private. Without it, GPL-3.0 would be equivalent
for all local use.

### Contributor terms

Inbound licence matches outbound — contributions are made under the licence of
the file they touch, stated in `CONTRIBUTING.md`, with the Developer Certificate
of Origin via `Signed-off-by`. **No copyright assignment and no CLA.** A CLA
would permit future relicensing but deters casual contributors and concentrates
control; we prefer the former cost to the latter.

The consequence to be clear-eyed about: without a CLA, this decision is
effectively permanent from the first external contribution onward.

## Consequences

- Community plugins may be licensed however their authors wish, including
  proprietary, with no ambiguity — MIT on `@yaz/api` is what guarantees this.
- Anyone offering yaz as a network service must publish their modifications.
- We ourselves cannot later relicense or dual-license commercially without
  contacting every contributor. **This forecloses a future commercial-licence
  business model.** If that option matters, the decision must change *now*.
- Some corporate environments restrict AGPL software, including on developer
  machines. This will cost some institutional users, and academic institutions
  vary in how strictly they apply such policies.
- AGPL is incompatible with linking some permissively-licensed-but-restricted
  dependencies, which constrains dependency choice in ways MIT would not.
- The split licence must be applied carefully — per-directory `LICENSE` files and
  SPDX headers — or it becomes ambiguous, which defeats the purpose.

## Alternatives considered

**MIT or Apache-2.0 throughout.** Maximum adoption, zero friction, standard for
Rust projects, and no corporate policy problems. Rejected in this proposal
because it permits a hosted commercial fork with no obligation to contribute
back, which is the specific outcome this project should not enable. Reconsider if
adoption is valued above that.

**GPL-3.0 for the application.** Equivalent to AGPL for a purely local
application and better understood by corporate policy. Rejected because it does
not cover the hosted-service case, which is the realistic risk here.

**Proprietary, like Obsidian.** Permits a commercial model and Obsidian shows an
ecosystem can still form. Rejected as inconsistent with a public repository and
community contribution, which the rest of these ADRs assume throughout.

**AGPL everywhere including the API package.** Simpler and more consistent.
Rejected because plugin authors would face real uncertainty about whether their
plugin must be AGPL. Even if the answer is favourable, the doubt suppresses
contribution, and no ecosystem is worth that argument.

## Decision required

Until this ADR is `Accepted`, the repository ships the licence files described
above **provisionally**. Confirm or change before merging the first external
contribution.
