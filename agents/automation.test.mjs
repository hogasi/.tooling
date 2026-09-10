import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  claimCorrection,
  resetCorrections,
  resolveCorrection
} from "./automation.mjs";
const context = {
  appLogin: "builder[bot]",
  issueNumber: "1",
  phase: "planner",
  repository: "org/repo",
  runId: "100",
  senderLogin: "builder[bot]",
  sourceRunId: "99"
};
function fixture() {
  const comments = [];
  const writes = [];
  const reads = new Map([
    ["repos/org/repo/issues/1/comments", [comments]],
    ["repos/org/repo/issues/1/labels", [{ name: "changes requested" }]]
  ]);
  const request = (options) => {
    if (!options.method) {
      return reads.get(options.path);
    }
    writes.push(options);
    if (options.path.endsWith("/comments")) {
      comments.push({
        body: options.body.body,
        id: 1,
        user: { login: context.appLogin }
      });
    } else if (options.method === "PATCH") {
      comments[0].body = options.body.body;
    }
    return {};
  };
  return { comments, request, writes };
}
test("duplicate evidence never consumes another attempt or posts another status comment", () => {
  const { comments, request, writes } = fixture();
  assert.equal(
    claimCorrection(context, { proposal: 10, source: "99" }, request).count,
    1
  );
  assert.equal(
    claimCorrection(context, { proposal: 10, source: "99" }, request),
    null
  );
  assert.equal(comments.length, 1);
  assert.equal(writes.length, 1);
});
test("three attempts persist across new runs and revisions, then pause", () => {
  const { comments, request, writes } = fixture();
  for (const number of [1, 2, 3]) {
    assert.equal(
      claimCorrection(
        { ...context, runId: String(100 + number) },
        { proposal: number },
        request
      ).count,
      number
    );
  }
  assert.throws(
    () => claimCorrection(context, { proposal: 4 }, request),
    /Three automatic/
  );
  assert.equal(comments.length, 1);
  assert.deepEqual(writes.at(-1).body, { labels: ["blocked"] });
  resetCorrections(context, request);
  assert.equal(claimCorrection(context, { proposal: 4 }, request).count, 1);
});
test("a forged human counter cannot suppress the automatic worker", () => {
  const { comments, request } = fixture();
  claimCorrection(context, { proposal: 1 }, request);
  comments[0].user.login = "human";
  assert.equal(claimCorrection(context, { proposal: 1 }, request).count, 1);
});
test("a malformed counter fails instead of resetting the budget", () => {
  const { comments, request } = fixture();
  claimCorrection(context, { proposal: 1 }, request);
  comments[0].body =
    '<!-- hogasi-ai correction planner {"count":-1,"keys":[]} -->';
  assert.throws(
    () => claimCorrection(context, { proposal: 2 }, request),
    /Malformed/
  );
});
test("untrusted senders and malformed handoff IDs are rejected before reading source evidence", () => {
  const request = () => assert.fail("Unexpected API call");
  assert.throws(
    () =>
      resolveCorrection({ ...context, senderLogin: "another[bot]" }, request),
    /Untrusted/
  );
  assert.throws(
    () => resolveCorrection({ ...context, sourceRunId: "../other" }, request),
    /Invalid/
  );
});
test("arbitrary successful workflows cannot start corrections", () => {
  assert.throws(
    () =>
      resolveCorrection(context, () => ({
        event: "issues",
        path: ".github/workflows/other.yml"
      })),
    /Untrusted/
  );
});

test("only a successful source review for the current proposal routes a correction", () => {
  const reviewContext = { ...context, reviewerLogin: "reviewer[bot]" };
  const body = "Implement the agreed scope.";
  const digest = createHash("sha256").update(`10\n${body}`).digest("hex");
  const checkpoint = {
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
  const finding = {
    body: `<!-- hogasi-review plan ${JSON.stringify({ digest, proposal: 10, run: "99.1", status: "changes_requested" })} -->\nAdd the missing test.`,
    id: 12,
    user: { login: reviewContext.reviewerLogin }
  };
  const reads = new Map([
    [
      "repos/org/repo/actions/runs/99",
      { event: "issues", path: ".github/workflows/ai.yml", run_attempt: 1 }
    ],
    [
      "repos/org/repo/actions/runs/99/attempts/1/jobs",
      [
        {
          jobs: [
            { conclusion: "success", name: "ai / Plan review / subscription" }
          ]
        }
      ]
    ],
    ["repos/org/repo/issues/1", { labels: [], state: "open" }],
    ["repos/org/repo/issues/1/comments", [[checkpoint, summary, finding]]]
  ]);
  const request = ({ path }) => {
    assert.ok(reads.has(path), path);
    return reads.get(path);
  };
  assert.equal(resolveCorrection(reviewContext, request).role, "planner");
  reads.set("repos/org/repo/issues/1/comments", [
    [checkpoint, summary, { ...finding, user: { login: "human" } }]
  ]);
  assert.equal(resolveCorrection(reviewContext, request).role, "");
  reads.set("repos/org/repo/actions/runs/99/attempts/1/jobs", [
    {
      jobs: [{ conclusion: "failure", name: "ai / Plan review / subscription" }]
    }
  ]);
  assert.throws(
    () => resolveCorrection(reviewContext, request),
    /not succeeded/
  );
});
