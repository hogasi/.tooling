# Plan

Where the org tooling is going, one file per stage. Finished stages move to
[done/](done/) — they stay readable as the record of why things are shaped the
way they are, but nothing in there is an outstanding task.

| Stage                                                      | State                                                                                                                                                        |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [0 — scaffold](done/stage-0-scaffold.md)                   | **Done.** Five packages and release CI. Merge-check enrollment and SHA-policy alignment remain in setup.                                                     |
| [1 — reusable CI, template repo](stage-1-template-repo.md) | Protect tooling now; derive reusable CI from product repo #1 and the template from repo #2.                                                                  |
| [2 — development in GitHub](stage-2-ai-layer.md)           | **Built, unproven.** `ai.yml`, the role prompts and the vendored discovery skill exist; nothing has run against GitHub. Astra selection is still unresolved. |

Cutting across all of them:

- [decisions.md](decisions.md) — settled questions and the GitHub limits that
  shape the layout. Read before changing any of them.
- [setup.md](setup.md) — org settings applied by hand, and what they should be.
- [deferred.md](deferred.md) — deliberately not done, each with the trigger that
  brings it back.

## Next work

1. Complete the tooling protection checklist in [setup.md](setup.md).
2. Apply the account and integration enrollment in [setup.md](setup.md) step 4 —
   App, secrets, labels, Codex — then run the stage 2 loop in a private sandbox
   with its own CI until phase A is proven. The files are written; none of them
   has run. This can start before product repo #1 exists.
3. Move the proven flow to product repo #1 and extract reusable CI. Derive the
   template only when repo #2 reveals what should be shared.

[Stage 2](stage-2-ai-layer.md#where-files-and-settings-belong) owns the file
layout and setting locations. Prompts and Claude model defaults ship in this
repo; credentials and enrollment live in GitHub; hosted Codex model selection
lives in Codex settings and must be verified.

**Deferred:** a separate AI tester, automatic repair loops, an architect gate,
repo steward, custom `.github/ai.yml` config schema, hosted GitHub App service,
`ci-base.yml`, and shared deploy workflows. Auto-merge is a separate future
decision after at least a month of real review evidence.
