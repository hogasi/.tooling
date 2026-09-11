import assert from "node:assert/strict";
import test from "node:test";

import { readRepairCi } from "./repair-evidence.mjs";

const context = {
  ciWorkflow: ".github/workflows/ci.yml",
  repository: "owner/repo"
};
const pull = {
  base: { repo: { full_name: context.repository } },
  created_at: "2026-09-10T01:00:00Z",
  head: {
    ref: "claude/issue-2",
    repo: { full_name: context.repository },
    sha: "a".repeat(40)
  },
  merged_at: "2026-09-10T03:00:00Z",
  number: 7,
  state: "closed"
};
const run = {
  conclusion: "success",
  created_at: "2026-09-10T02:00:00Z",
  event: "pull_request",
  head_branch: pull.head.ref,
  head_repository: { full_name: context.repository },
  head_sha: pull.head.sha,
  id: 10,
  path: context.ciWorkflow,
  pull_requests: [],
  status: "completed"
};
const request =
  (runs, pulls = [pull]) =>
  ({ path }) =>
    path.includes("/actions/runs?") ? [{ workflow_runs: runs }] : [pulls];

test("merged child CI remains verifiable when GitHub clears its PR list", () => {
  assert.deepEqual(readRepairCi(context, pull, request([run])), run);
});

test("merged CI recovery rejects another branch, repository, workflow or PR lifetime", () => {
  for (const change of [
    { head_branch: "claude/issue-1" },
    { head_sha: "b".repeat(40) },
    { head_repository: { full_name: "foreign/repo" } },
    { path: ".github/workflows/other.yml" },
    { event: "push" },
    { created_at: "2026-09-10T00:00:00Z" },
    { created_at: "2026-09-10T04:00:00Z" },
    { created_at: "invalid" },
    { pull_requests: [{ number: 8 }] }
  ]) {
    assert.equal(
      readRepairCi(context, pull, request([{ ...run, ...change }])),
      undefined
    );
  }
});

test("open PRs still require direct CI association", () => {
  assert.equal(
    readRepairCi(
      context,
      { ...pull, merged_at: null, state: "open" },
      request([run])
    ),
    undefined
  );
});

test("a reused branch cannot supply ambiguous merged CI evidence", () => {
  assert.throws(
    () =>
      readRepairCi(
        context,
        pull,
        request([run], [pull, { ...pull, number: 8 }])
      ),
    /Ambiguous merged PR CI/
  );
});

test("a later failing CI run cannot be hidden by an earlier passing run", () => {
  const failed = { ...run, conclusion: "failure", id: 11 };
  assert.deepEqual(readRepairCi(context, pull, request([run, failed])), failed);
});
