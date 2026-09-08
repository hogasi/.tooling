#!/usr/bin/env sh
# Runs the same gates as CI before a commit is created.
# Installed by simple-git-hooks from the root `prepare` script.
set -eu
cd "$(git rev-parse --show-toplevel)"

# GUI Git clients do not read shell startup files, so without sourcing nvm
# `node` is whatever happens to be on a bare PATH, if anything at all. The
# version check below is the gate; this only gives it a chance to pass.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1091 # nvm lives outside the repo; nothing to follow.
  . "$NVM_DIR/nvm.sh"
  nvm use --silent >/dev/null 2>&1 || true
fi

# `.nvmrc` pins a major only, so compare majors: every 24.x satisfies `24`.
required=$(tr -d '[:space:]' < .nvmrc | cut -d. -f1)
current=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo none)

if [ "$current" != "$required" ]; then
  echo "pre-commit: needs Node $required, found $current. Run 'nvm install'." >&2
  exit 1
fi

# `git --staged` rather than the deprecated `protect` subcommand. Unlike the CI
# job this scans the staged diff only: catching a secret before it reaches
# history is the whole point, and rescanning history on every commit is slow.
if command -v gitleaks >/dev/null 2>&1; then
  gitleaks git --staged --no-banner --redact
else
  echo "pre-commit: gitleaks missing, secret scan skipped. brew install gitleaks" >&2
fi

# Formatting is whitespace-only, so applying it to the commit is safe and
# saves a round trip. ESLint is deliberately not auto-fixed: its fixes can
# rewrite logic, and that belongs under review, not inside a commit hook.
staged=$(mktemp)
trap 'rm -f "$staged"' EXIT
git diff --cached --name-only --diff-filter=ACMR -z > "$staged"

pnpm format

# Re-stage only what was already staged. `git add -u` would sweep in changes
# that were left out of this commit on purpose.
if [ -s "$staged" ]; then
  xargs -0 git add -- < "$staged"
fi

pnpm check
