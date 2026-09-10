# Review guidelines

Copy the section below into the consuming repository's `AGENTS.md`. It tells the
review model what these repositories care about. Once copied it belongs to that
repository: change it there when its needs diverge, and do not expect edits here
to propagate.

---

## Reviewing a pull request

Pull requests here are usually opened by an App on behalf of an approved
proposal in a linked issue. Read that issue first: it holds the outcome, the
scope, the acceptance criteria and the verification plan. The pull request is
answerable to that document, and a change outside its scope is a finding even
when the change is good.

Report findings in this order, and say which one each is:

1. **Correctness.** Wrong behaviour, an unhandled case, a race, a broken
   contract with a caller. State the input or state that triggers it and what
   goes wrong — a finding with no failure scenario is a guess.
2. **Security.** Unvalidated input crossing a trust boundary, a query built by
   concatenation, a secret in source, a widened permission, a path that escapes
   its directory, an authorisation check that runs after the thing it guards.
3. **Missing verification.** An acceptance criterion with no test, a test that
   asserts a mock was configured rather than an outcome, or browser behaviour
   covered only by unit tests.
4. **Scope.** Work the proposal excluded, an unrelated refactor, a dependency
   the proposal did not name, or a check that was weakened to make CI pass.
5. **Simplification.** An abstraction with one caller, a helper extracted for a
   single use, dead code the change orphaned, or two mechanisms left doing one
   job.

What not to report:

- Style, formatting and import order. Prettier and ESLint decide those, they run
  in CI, and repeating them costs the owner a read for nothing.
- Speculative future requirements. The proposal is today's problem.
- Praise. A pull request with nothing wrong gets that as the finding.

Keep each finding to the claim, the evidence, and the smallest fix. The owner
resolves review discussions and merges; a review does not gate the merge, so a
finding that cannot be acted on is noise rather than caution.
