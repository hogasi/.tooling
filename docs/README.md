# Plan

Where the org tooling is going, one file per stage. Finished stages move to
[done/](done/) — they stay readable as the record of why things are shaped the
way they are, but nothing in there is an outstanding task.

| Stage                                                      | State                                                                                                    |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [0 — scaffold](done/stage-0-scaffold.md)                   | **Done.** Five packages and release CI. Merge-check enrollment and SHA-policy alignment remain in setup. |
| [1 — reusable CI, template repo](stage-1-template-repo.md) | Protect tooling now; derive reusable CI from product repo #1 and the template from repo #2.              |
| [2 — development in GitHub](stage-2-ai-layer.md)           | **V1 sandbox proven; v2 in progress.** Records first, then automation and stacks.                        |

Cutting across all of them:

- [decisions.md](decisions.md) — settled questions and the GitHub limits that
  shape the layout. Read before changing any of them.
- [setup.md](setup.md) — org settings applied by hand, and what they should be.
- [deferred.md](deferred.md) — deliberately not done, each with the trigger that
  brings it back.

## Next work

1. Deliver workflow v2: records/approval, automatic correction, then sub-issues
   and dependent stacks. Each increment needs sandbox proof.
2. Enroll product repo #1 after the workflow is proven; derive reusable CI from
   that consumer and a template only when repo #2 reveals what is shared.

[Stage 2](stage-2-ai-layer.md) owns the current contract and setting locations.
[Setup](setup.md) owns consumer migration and credentials.
