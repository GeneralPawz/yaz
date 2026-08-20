# 0018 — Licensing: AGPL-3.0 application, MIT plugin API

- **Status:** Accepted
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

## Decision

**Split licensing:**

| Component                      | Licence               | Reasoning                                                                                               |
| ------------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------- |
| `crates/`, `apps/`, `plugins/` | **AGPL-3.0-or-later** | Improvements to the application return to the project, including from anyone hosting it as a service    |
| `packages/api` (`@yaz/api`)    | **MIT**               | Plugin authors link against it and must be free to license their work as they choose, with no ambiguity |
| `packages/plugin-template`     | **MIT**               | A starter template must not dictate the licence of what is built from it                                |
| `docs/`                        | **CC BY-SA 4.0**      | Prose, not code                                                                                         |

The AGPL network clause is doing real work here despite this being a desktop
application: it is what prevents a hosted Overleaf-style competitor built on this
code from keeping its changes private. Without it, GPL-3.0 would be equivalent
for all local use.

### What this does and does not prevent

Stated precisely, because the distinction decided this ADR:

**AGPL does not forbid selling yaz.** Anyone may charge money for copies — the
licence explicitly permits it. What they cannot do is keep their modifications
private, and that is what removes the commercial advantage in forking: a
competitor must hand their improvements, and their source, to every user they
sell or host it for.

**Forbidding sale outright would require a non-commercial licence** such as
PolyForm Noncommercial. That is not open source, excludes companies entirely,
and measurably deters contributors. It was rejected because contributor
friction was judged the larger cost — see the decision record below.

### The open-core option remains available, without a CLA

If commercial revenue is ever wanted, the route that stays open is OpenProject's:
an open core plus **proprietary add-ons written by the project owner**. This
project is unusually well-shaped for it, because the plugin architecture in
[0005](0005-extensibility-tiers.md) already makes add-ons a first-class concept,
and the **MIT licence on `@yaz/api` is what makes a proprietary plugin legally
clean** — a plugin links against permissively-licensed API code, not against the
AGPL application.

That route requires no CLA, because the paid components would be new code the
owner already holds copyright in. **Selling commercial licences to the existing
codebase does not stay available**, since that would require owning every
contributor's copyright. That trade was made deliberately.

### Contributor terms

Inbound licence matches outbound — contributions are made under the licence of
the file they touch, stated in `CONTRIBUTING.md`, with the Developer Certificate
of Origin via `Signed-off-by`. **No copyright assignment and no CLA.** A CLA
would permit future relicensing but deters casual contributors and concentrates
control; we prefer the former cost to the latter.

The consequence to be clear-eyed about: without a CLA, this decision is
effectively permanent from the first external contribution onward. This was
chosen knowingly — lowering the barrier for drive-by contributors was valued
above retaining the ability to relicense or dual-licence later.

## Consequences

- Community plugins may be licensed however their authors wish, including
  proprietary, with no ambiguity — MIT on `@yaz/api` is what guarantees this.
- Anyone offering yaz as a network service must publish their modifications.
- We ourselves cannot later relicense or dual-license commercially without
  contacting every contributor. **This forecloses a future commercial-licence
  business model.** If that option matters, the decision must change _now_.
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

**PolyForm Noncommercial, with commercial licences sold separately.** The literal
reading of "free for the community, companies pay": companies cannot use it at
all without buying a licence. Rejected because it is not open source, and because
selling those licences requires owning all contributor copyright — that is, a
CLA. Contributor friction was judged the larger cost, and the CLA was explicitly
declined.

**PolyForm Small Business.** Free for noncommercial use and for companies under
roughly 100 employees. Rejected for the same reasons: not open source, and it
still needs a CLA to monetise the larger tier.

**Functional Source License (FSL).** Free for everything except building a
competing product, converting to Apache-2.0 after two years. Genuinely attractive
and lower-friction than AGPL for corporate users. Rejected because the two-year
conversion means a competitor need only wait, and because AGPL is a known
quantity that contributors and lawyers already understand.

## Dependency constraint this creates

AGPL is incompatible with linking some permissively-licensed-but-restricted
code, so every dependency must be licence-checked before adoption. In particular
the embedded LaTeX engine ([0007](0007-latex-compilation-engines.md)) vendors TeX
engine sources with their own terms, and needs an explicit audit rather than an
assumption that "Tectonic is MIT" settles it.
