import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  beginReview,
  publishReview,
  requirePlanReview,
  validateVerdict
} from "./review.mjs";

const body = "Implement greeting validation.";
const sha = "a".repeat(40);
const digest = createHash("sha256").update(`10\n${body}`).digest("hex");
const issue = {
  body,
  labels: [{ name: "in review" }],
  number: 7,
  state: "open"
};
const context = {
  appLogin: "builder[bot]",
  attempt: "1",
  eventBody: body,
  issueNumber: "7",
  repository: "hogasi/sandbox",
  reviewerLogin: "hogasi-review[bot]",
  runId: "123",
  sha
};
const snapshot = { digest, proposal: 10, run: "123.1", sha };
const record = (status = "pass", overrides = {}) => ({
  body: `<!-- hogasi-review plan ${JSON.stringify({ ...snapshot, status })} -->`,
  id: 1,
  updated_at: "2026-09-10T10:01:00Z",
  user: { login: context.reviewerLogin },
  ...overrides
});
const pass = {
  findings: [],
  summary: "Checked the plan against the repository.",
  verdict: "pass"
};
function fixture({
  comments = [record()],
  current = issue,
  currentSha = sha,
  proposalBody = body
} = {}) {
  const writes = [];
  const reads = new Map([
    ["repos/hogasi/sandbox", { default_branch: "main" }],
    ["repos/hogasi/sandbox/commits/main", { sha: currentSha }],
    ["repos/hogasi/sandbox/issues/7", current],
    [
      "repos/hogasi/sandbox/issues/7/comments",
      [
        comments,
        [
          {
            body: `<!-- hogasi-ai proposal -->\n${proposalBody}`,
            created_at: "2026-09-10T10:00:00Z",
            id: 10,
            updated_at: "2026-09-10T10:00:00Z",
            user: { login: context.appLogin }
          },
          {
            body: '<!-- hogasi-ai planning {"proposal":10} -->',
            id: 11,
            user: { login: context.appLogin }
          }
        ]
      ]
    ],
    ["repos/hogasi/sandbox/issues/7/labels", current.labels]
  ]);
  const request = (options) => {
    if (options.method && options.method !== "GET") {
      writes.push(options);
      return {};
    }
    assert.ok(reads.has(options.path));
    return reads.get(options.path);
  };
  return { request, writes };
}
test("a label without a reviewer record cannot authorize development", () => {
  const { request } = fixture({ comments: [] });
  assert.throws(
    () => requirePlanReview({ ...context, issue }, request),
    /current passing/
  );
});
test("human and other bot records cannot authorize development", () => {
  for (const login of ["owner", "hogasi-ai[bot]"]) {
    const { request } = fixture({
      comments: [record("pass", { user: { login } })]
    });
    assert.throws(
      () => requirePlanReview({ ...context, issue }, request),
      /current passing/
    );
  }
});
test("a current passing reviewer record authorizes development", () => {
  const { request } = fixture();
  assert.doesNotThrow(() => requirePlanReview({ ...context, issue }, request));
});
test("changed proposal invalidates the pass but main movement does not", () => {
  assert.throws(
    () =>
      requirePlanReview(context, fixture({ proposalBody: "Changed" }).request),
    /passing/
  );
  assert.doesNotThrow(() =>
    requirePlanReview(context, fixture({ currentSha: "b".repeat(40) }).request)
  );
});
test("a later pending or failed record supersedes a prior pass", () => {
  for (const status of ["pending", "changes_requested"]) {
    const { request } = fixture({
      comments: [record(), record(status, { id: 2 })]
    });
    assert.throws(
      () => requirePlanReview({ ...context, issue }, request),
      /current passing/
    );
  }
});
test("review start retracts a pass and records pending before model execution", () => {
  const { request, writes } = fixture({
    current: { ...issue, labels: [...issue.labels, { name: "reviewed" }] }
  });
  assert.deepEqual(beginReview(context, request).snapshot, {
    ...snapshot,
    pulls: []
  });
  assert.equal(writes[0].method, "PATCH");
  assert.match(writes[0].body.body, /pending/);
});
test("stale queued events do not change current labels", () => {
  const { request, writes } = fixture({
    currentSha: "b".repeat(40)
  });
  assert.throws(() => beginReview(context, request), /changed/);
  assert.equal(writes.length, 0);
});
test("valid pass is published before applying reviewed", () => {
  const { request, writes } = fixture({ comments: [record("pending")] });
  publishReview({ ...context, snapshot, verdict: pass }, request);
  assert.match(writes[0].body.body, /"status":"pass"/);
  assert.deepEqual(writes.at(-1).body, { labels: ["approved"] });
});
test("findings remove ready without approving development", () => {
  const { request, writes } = fixture({ comments: [record("pending")] });
  publishReview(
    {
      ...context,
      snapshot,
      verdict: {
        ...pass,
        findings: ["Acceptance criterion lacks a test."],
        verdict: "changes_requested"
      }
    },
    request
  );
  assert.match(writes[0].body.body, /Acceptance criterion/);
  assert.match(writes[1].path, /labels\/in%20review$/);
});
test("publication rejects changed proposal, repository, or removed ready", () => {
  for (const options of [
    { proposalBody: "New" },
    { currentSha: "b".repeat(40) },
    { current: { ...issue, labels: [] } }
  ]) {
    const { request, writes } = fixture({
      ...options,
      comments: [record("pending")]
    });
    assert.throws(
      () => publishReview({ ...context, snapshot, verdict: pass }, request),
      /changed|review/
    );
    assert.equal(writes.length, 0);
  }
});
test("a duplicate publication does not post twice", () => {
  const { request, writes } = fixture();
  publishReview({ ...context, snapshot, verdict: pass }, request);
  assert.equal(writes.length, 0);
});
test("malformed or inconsistent verdicts fail closed", () => {
  for (const value of [
    null,
    {},
    { ...pass, extra: true },
    { ...pass, summary: "" },
    { ...pass, findings: ["Defect"] },
    { ...pass, verdict: "changes_requested" },
    { ...pass, findings: [42] }
  ]) {
    assert.throws(() => validateVerdict(value), /verdict/);
  }
});
test("a malformed latest reviewer record fails closed", () => {
  const { request } = fixture({
    comments: [
      record(),
      record("pass", { body: "<!-- hogasi-review plan broken -->", id: 2 })
    ]
  });
  assert.throws(
    () => requirePlanReview({ ...context, issue }, request),
    /Malformed/
  );
});
