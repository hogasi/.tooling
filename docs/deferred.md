# Deferred

Deliberately not done. Each carries the trigger that should bring it back.

## TypeScript 7 cannot be adopted yet

`pnpm update --latest` moved TypeScript to 7.0.2, which typescript-eslint
refuses to load against: its peer range is `>=4.8.4 <6.1.0` and the plugin
throws on import rather than degrading. TypeScript is pinned to `^6.0.3`, and
`@hogasi/eslint-config` declares the same bound as its own peer range rather
than a plain caret, so a consumer on TS 7 gets a resolution error instead of a
crash at lint time.

unicorn 74 split `prevent-abbreviations` in two. `name-replacements` is the half
that wants `rootDir` to become `rootDirectory`, so it is off for the same reason
its parent was. The other two new rules were right and the code changed instead:
`consistent-boolean-name`, and `require-array-sort-compare`, which was flagging
`.toSorted()` comparisons that are clearer as `Set` comparisons anyway.

## Product rollout and optional automation

- **Product required checks** wait for an actual CI consumer and observed check
  names. Scope them to those repositories. `.tooling` already has checks and
  must not wait for product repo #1; see [setup.md](setup.md).
- **Required approvals remain 0** so the owner can merge their own PRs.
  Deterministic CI is required; Codex feedback and the owner's merge decision
  provide review. There is no planned `ai/test` or AI review check.
- **Org-admin bypass is initially `always`.** Tighten to `pull_request` after
  the protected PR repair path is proven. The AI App receives no bypass.
- **Automatic repair loops** wait for repetitive work observed during stage 2.
  First prove event routing and add an enforced cap; initial repairs are owner
  requests in PR comments.
- **Auto-merge** requires a separate decision after at least a month of real
  review evidence, including a policy for waiting for review completion.
- **Exact Astra review selection** must be verified in the linked Codex account.
  If unavailable, hosted review versus API-backed Astra requires an explicit
  owner decision about model and billing. See [stage 2](stage-2-ai-layer.md).
- **A separate AI tester is removed from the design.** Opus writes tests and CI
  executes them independently. Revisit only if real acceptance gaps justify an
  additional role.

## Not adopted from sil

- **`boot-smoke`.** Product-specific; there is nothing here to boot.
- **`claude.yml` as written.** Do not invoke agents for arbitrary comment
  authors. Stage 2 requires authorized human triggers and validates approval
  outside the prompt, while retaining the Claude Action's access checks.
