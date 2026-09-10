import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  beginPullRequestReview,
  publishPullRequestReview
} from "./pr-review.mjs";

const sha = (character) => character.repeat(40);
const issue = {
  body: "Return a fallback greeting.",
  labels: ["ready", "reviewed", "ready for dev"].map((name) => ({ name })),
  number: 9,
  state: "open"
};
const digest = createHash("sha256").update(issue.body).digest("hex");
const pullRequest = {
  base: { ref: "main", repo: { full_name: "hogasi/sandbox" }, sha: sha("a") },
  draft: false,
  head: {
    ref: "claude/issue-9",
    repo: { full_name: "hogasi/sandbox" },
    sha: sha("b")
  },
  number: 10,
  state: "open",
  user: { login: "hogasi-ai[bot]" }
};
const context = {
  appLogin: "hogasi-ai[bot]",
  defaultBranch: "main",
  effort: "medium",
  eventBase: sha("a"),
  eventHead: sha("b"),
  issueNumber: "9",
  model: "gpt-6-astra",
  pullRequestNumber: "10",
  repository: "hogasi/sandbox",
  reviewerLogin: "hogasi-review[bot]",
  runId: "123"
};
const pass = {
  findings: [],
  summary: "No defects found in the supplied diff.",
  verdict: "pass"
};
function fixture(overrides = {}) {
  const state = { issue, pullRequest, reviews: [], ...overrides };
  const writes = [];
  const reads = new Map([
    ["repos/hogasi/sandbox/issues/9", state.issue],
    [
      "repos/hogasi/sandbox/issues/9/comments",
      [
        [
          {
            body: `<!-- hogasi-ai approval sha256=${digest} run=100 -->`,
            id: 1,
            user: { login: context.appLogin }
          }
        ]
      ]
    ],
    ["repos/hogasi/sandbox/issues/10/comments", [[]]],
    ["repos/hogasi/sandbox/pulls/10", state.pullRequest],
    ["repos/hogasi/sandbox/pulls/10/reviews", [state.reviews]],
    [
      `repos/hogasi/sandbox/actions/runs?head_sha=${sha("b")}&per_page=100`,
      [
        {
          workflow_runs: [
            {
              conclusion: "success",
              head_sha: sha("b"),
              id: 100,
              name: "CI",
              status: "completed"
            }
          ]
        }
      ]
    ]
  ]);
  const callGitHub = (options) => {
    if (options.method === "POST") {
      writes.push(options);
      return {};
    }
    assert.ok(reads.has(options.path), options.path);
    return reads.get(options.path);
  };
  return { callGitHub, reads, writes };
}
const start = () => beginPullRequestReview(context, fixture().callGitHub);
test("captures the approved proposal and CI for the exact head", () => {
  const review = start();
  assert.equal(review.snapshot.head, sha("b"));
  assert.equal(review.snapshot.base, sha("a"));
  assert.equal(review.snapshot.digest, digest);
  assert.equal(review.ci[0].conclusion, "success");
  assert.equal(review.proposal.body, issue.body);
});
test("publishes a COMMENT review tied to the head, never a merge approval", () => {
  const review = start();
  const { callGitHub, writes } = fixture();
  publishPullRequestReview(
    { ...context, ...review, verdict: pass },
    callGitHub
  );
  assert.equal(writes.length, 1);
  assert.equal(writes[0].body.event, "COMMENT");
  assert.equal(writes[0].body.commit_id, sha("b"));
  assert.match(writes[0].body.body, /No defects found/);
});
test("findings publish as feedback without requesting repairs", () => {
  const { callGitHub, writes } = fixture();
  publishPullRequestReview(
    {
      ...context,
      ...start(),
      verdict: {
        ...pass,
        findings: ["src/greet.js:10 rejects the approved blank input."],
        verdict: "changes_requested"
      }
    },
    callGitHub
  );
  assert.equal(writes[0].body.event, "COMMENT");
  assert.match(writes[0].body.body, /src\/greet.js:10/);
  assert.doesNotMatch(writes[0].body.body, /@claude/);
});
for (const change of [
  {
    pullRequest: {
      ...pullRequest,
      head: { ...pullRequest.head, sha: sha("c") }
    }
  },
  {
    pullRequest: {
      ...pullRequest,
      base: { ...pullRequest.base, sha: sha("c") }
    }
  },
  { issue: { ...issue, body: "Changed proposal" } },
  { issue: { ...issue, labels: [] } },
  { pullRequest: { ...pullRequest, draft: true } },
  { pullRequest: { ...pullRequest, state: "closed" } },
  {
    pullRequest: {
      ...pullRequest,
      head: { ...pullRequest.head, repo: { full_name: "outside/fork" } }
    }
  }
]) {
  test(`rejects stale publication ${JSON.stringify(change)}`, () => {
    const { callGitHub, writes } = fixture(change);
    assert.throws(() =>
      publishPullRequestReview(
        { ...context, ...start(), verdict: pass },
        callGitHub
      )
    );
    assert.equal(writes.length, 0);
  });
}
test("an old queued event is rejected before any model call", () => {
  assert.throws(
    () =>
      beginPullRequestReview(
        { ...context, eventHead: sha("c") },
        fixture().callGitHub
      ),
    /changed/
  );
});
test("a published review suppresses retries before spending subscription allowance", () => {
  const review = start();
  const first = fixture();
  publishPullRequestReview(
    { ...context, ...review, verdict: pass },
    first.callGitHub
  );
  const published = {
    body: first.writes[0].body.body,
    commit_id: sha("b"),
    state: "COMMENTED",
    user: { login: context.reviewerLogin }
  };
  const { callGitHub, writes } = fixture({ reviews: [published] });
  assert.equal(beginPullRequestReview(context, callGitHub), null);
  publishPullRequestReview(
    { ...context, ...review, verdict: pass },
    callGitHub
  );
  assert.equal(writes.length, 0);
});
test("a copied human review cannot suppress the reviewer", () => {
  const review = start();
  const first = fixture();
  publishPullRequestReview(
    { ...context, ...review, verdict: pass },
    first.callGitHub
  );
  const { callGitHub } = fixture({
    reviews: [
      {
        body: first.writes[0].body.body,
        commit_id: sha("b"),
        state: "COMMENTED",
        user: { login: "owner" }
      }
    ]
  });
  assert.ok(beginPullRequestReview(context, callGitHub));
});
test("malformed verdicts never create PR reviews", () => {
  const { callGitHub, writes } = fixture();
  assert.throws(
    () =>
      publishPullRequestReview(
        { ...context, ...start(), verdict: {} },
        callGitHub
      ),
    /verdict/
  );
  assert.equal(writes.length, 0);
});

test("CI pagination preserves pending runs and excludes other commits", () => {
  const { callGitHub, reads, writes } = fixture();
  reads.set(
    `repos/hogasi/sandbox/actions/runs?head_sha=${sha("b")}&per_page=100`,
    [
      {
        workflow_runs: [
          {
            conclusion: "success",
            head_sha: sha("c"),
            name: "Unrelated",
            status: "completed"
          }
        ]
      },
      {
        workflow_runs: [
          {
            conclusion: null,
            head_sha: sha("b"),
            id: 2,
            name: "Tests",
            status: "queued"
          }
        ]
      }
    ]
  );
  const review = beginPullRequestReview(context, callGitHub);
  assert.equal(review.ci.length, 1);
  publishPullRequestReview(
    { ...context, ...review, verdict: pass },
    callGitHub
  );
  assert.match(writes[0].body.body, /Tests: queued \(no conclusion\)/);
  assert.doesNotMatch(writes[0].body.body, /Unrelated/);
});

test("missing CI remains explicitly unverified", () => {
  const { callGitHub, reads, writes } = fixture();
  reads.set(
    `repos/hogasi/sandbox/actions/runs?head_sha=${sha("b")}&per_page=100`,
    [{ workflow_runs: [] }]
  );
  const review = beginPullRequestReview(context, callGitHub);
  publishPullRequestReview(
    { ...context, ...review, verdict: pass },
    callGitHub
  );
  assert.match(writes[0].body.body, /No Actions runs reported/);
});

test("a review on a later page suppresses duplicates but a different effort does not", () => {
  const first = fixture();
  publishPullRequestReview(
    { ...context, ...start(), verdict: pass },
    first.callGitHub
  );
  const { callGitHub, reads } = fixture();
  reads.set("repos/hogasi/sandbox/pulls/10/reviews", [
    [],
    [
      {
        body: first.writes[0].body.body,
        commit_id: sha("b"),
        state: "COMMENTED",
        user: { login: context.reviewerLogin }
      }
    ]
  ]);
  assert.equal(beginPullRequestReview(context, callGitHub), null);
  assert.ok(beginPullRequestReview({ ...context, effort: "low" }, callGitHub));
});
