import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { applyApproval, readApprovedProposal } from "./approval.mjs";
const context = {
  actor: "owner",
  appLogin: "builder[bot]",
  event: {
    action: "labeled",
    issue: { number: 7 },
    label: { name: "ready for dev" }
  },
  issueNumber: "7",
  mode: "verify",
  repository: "org/repo",
  reviewerLogin: "reviewer[bot]",
  runId: "100"
};
const body = "Implement the deliverable.";
const digest = createHash("sha256").update(`10\n${body}`).digest("hex");
const proposal = {
  body: `<!-- hogasi-ai proposal -->\n${body}`,
  created_at: "2026-09-10T10:00:00Z",
  id: 10,
  updated_at: "2026-09-10T10:00:00Z",
  user: { login: context.appLogin }
};
const summary = {
  body: '<!-- hogasi-ai planning {"proposal":10} -->',
  id: 11,
  user: { login: context.appLogin }
};
const review = {
  body: `<!-- hogasi-review plan ${JSON.stringify({ digest, proposal: 10, run: "99.1", sha: "a".repeat(40), status: "pass" })} -->`,
  id: 12,
  updated_at: "2026-09-10T10:01:00Z",
  user: { login: context.reviewerLogin }
};
const authorization = {
  body: `<!-- hogasi-ai authorization ${JSON.stringify({ actor: "owner", digest, event: 20, proposal: 10 })} -->`,
  id: 13,
  user: { login: context.appLogin }
};
const event = {
  actor: { login: "owner" },
  created_at: "2026-09-10T10:02:00Z",
  event: "labeled",
  id: 20,
  label: { name: "ready for dev" }
};
function fixture(overrides = {}) {
  const state = {
    authorization,
    event,
    permission: "write",
    proposal,
    review,
    ...overrides
  };
  const issue = {
    body: "Original request",
    labels: [{ name: "approved" }, { name: "ready for dev" }],
    number: 7,
    state: "open",
    ...overrides.issue
  };
  const writes = [];
  const reads = new Map([
    ["repos/org/repo/actions/runs/100", { created_at: "2026-09-10T10:03:00Z" }],
    [
      "repos/org/repo/collaborators/owner/permission",
      { permission: state.permission }
    ],
    ["repos/org/repo/issues/7", issue],
    [
      "repos/org/repo/issues/7/comments",
      [
        [state.proposal, summary, state.review, state.authorization].filter(
          Boolean
        )
      ]
    ],
    ["repos/org/repo/issues/7/events", [[state.event]]],
    ["repos/org/repo/issues/7/labels", issue.labels]
  ]);
  const request = (options) => {
    if (options.method) {
      writes.push(options);
      return {};
    }
    assert.ok(reads.has(options.path), options.path);
    return reads.get(options.path);
  };
  return { request, writes };
}
test("records a reviewed checkpoint and transitions to in development", () => {
  const { request, writes } = fixture({ authorization: null });
  assert.equal(applyApproval({ ...context, mode: "record" }, request), digest);
  assert.match(writes[0].body.body, /"proposal":10/);
  assert.deepEqual(writes.at(-1).body, { labels: ["in development"] });
});
test("repairs retain approval across main and summary changes without reading main", () => {
  assert.equal(
    applyApproval(
      context,
      fixture({ issue: { body: "Changed original request" } }).request
    ),
    digest
  );
  assert.equal(
    readApprovedProposal(context, fixture().request).proposal.body,
    body
  );
});
for (const overrides of [
  { authorization: null },
  { authorization: { ...authorization, user: { login: "owner" } } },
  {
    authorization: {
      ...authorization,
      body: '<!-- hogasi-ai authorization {"cleared":true} -->'
    }
  },
  { proposal: { ...proposal, body: proposal.body + "Changed" } },
  { proposal: { ...proposal, updated_at: "2026-09-10T10:01:00Z" } },
  { event: { ...event, id: 21 } },
  { event: { ...event, event: "unlabeled" } },
  { issue: { labels: [] } },
  { permission: "read" },
  { issue: { state: "closed" } }
]) {
  test(`rejects invalidated authorization ${JSON.stringify(overrides)}`, () => {
    const { request, writes } = fixture(overrides);
    assert.throws(() => applyApproval(context, request));
    assert.equal(writes.length, 0);
  });
}
test("old owner event cannot approve a later review or re-applied label", () => {
  for (const overrides of [
    { review: { ...review, updated_at: "2026-09-10T10:02:00Z" } },
    { event: { ...event, created_at: "2026-09-10T10:04:00Z" } }
  ]) {
    const { request, writes } = fixture(overrides);
    assert.throws(
      () => applyApproval({ ...context, mode: "record" }, request),
      /approval event/
    );
    assert.equal(writes.length, 0);
  }
});
test("a different approved revision cannot replace queued scope", () => {
  assert.throws(
    () =>
      applyApproval(
        { ...context, expectedDigest: "b".repeat(64) },
        fixture().request
      ),
    /queued/
  );
});
test("an approval record cannot be minted without a passing review", () => {
  assert.throws(
    () =>
      applyApproval(
        { ...context, mode: "record" },
        fixture({ review: null }).request
      ),
    /passing/
  );
});
test("replan revokes authorization before setting learning status", () => {
  const { request, writes } = fixture();
  applyApproval({ ...context, mode: "clear" }, request);
  assert.match(writes[0].path, /ready%20for%20dev/);
  assert.match(writes[1].body.body, /cleared/);
});
test("legacy approvals cannot silently authorize the new record format", () => {
  const { request } = fixture({
    authorization: {
      ...authorization,
      body: `<!-- hogasi-ai approval sha256=${digest} -->`
    }
  });
  assert.throws(() => applyApproval(context, request), /No approval/);
});
