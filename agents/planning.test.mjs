import assert from "node:assert/strict";
import test from "node:test";

import { capturePlanning, publishPlanning } from "./planning.mjs";

const context = {
  appLogin: "builder[bot]",
  issueNumber: "1",
  repository: "org/repo"
};
const result = {
  kind: "proposal",
  proposal: "Implement the requested contract and tests.",
  summary: "The scope is settled."
};
function fixture() {
  const issue = {
    body: "Original request",
    labels: [{ name: "learning" }],
    number: 1,
    state: "open"
  };
  const comments = [
    {
      body: '<!-- hogasi-ai planning {"proposal":null} -->\nDiscovery',
      id: 10,
      user: { login: context.appLogin }
    }
  ];
  const writes = [];
  const request = (options) => {
    if (!options.method) {
      return new Map([
        ["repos/org/repo/issues/1", issue],
        ["repos/org/repo/issues/1/comments", [comments]],
        ["repos/org/repo/issues/1/labels", issue.labels]
      ]).get(options.path);
    }
    writes.push(options);
    if (options.method === "PATCH") {
      comments[0] = { ...comments[0], body: options.body.body };
    } else if (options.path.endsWith("/comments")) {
      const comment = {
        body: options.body.body,
        created_at: "2026-09-10T12:00:00Z",
        id: 10 + comments.length,
        updated_at: "2026-09-10T12:00:00Z",
        user: { login: context.appLogin }
      };
      comments.push(comment);
      return comment;
    }
    return {};
  };
  return { comments, issue, request, writes };
}
test("publication saves the checkpoint, updates the existing summary, then requests review", () => {
  const { comments, issue, request, writes } = fixture();
  const snapshot = capturePlanning(context, request);
  publishPlanning({ ...context, result, snapshot }, request);
  assert.equal(issue.body, "Original request");
  assert.equal(comments.length, 2);
  assert.match(comments[0].body, /"proposal":11/);
  assert.equal(
    comments[1].body,
    `<!-- hogasi-ai proposal -->\n${result.proposal}`
  );
  assert.equal(writes[0].method, "POST");
  assert.equal(writes[1].method, "PATCH");
  assert.deepEqual(writes.at(-1).body, { labels: ["in review"] });
});
test("unanswered discovery updates one summary without creating a review checkpoint", () => {
  const { comments, request, writes } = fixture();
  publishPlanning(
    {
      ...context,
      result: {
        kind: "question",
        proposal: "",
        summary: "Which user group should this serve?"
      },
      snapshot: capturePlanning(context, request)
    },
    request
  );
  assert.equal(comments.length, 1);
  assert.match(comments[0].body, /Which user/);
  assert.equal(writes.length, 1);
});
test("an unchanged proposal is reused instead of creating another checkpoint", () => {
  const { comments, request } = fixture();
  publishPlanning(
    { ...context, result, snapshot: capturePlanning(context, request) },
    request
  );
  publishPlanning(
    { ...context, result, snapshot: capturePlanning(context, request) },
    request
  );
  assert.equal(comments.length, 2);
});
for (const change of [
  (state) => {
    state.issue.body = "Changed request";
  },
  (state) => {
    state.issue.labels = [{ name: "ready for dev" }];
  },
  (state) => {
    state.issue.state = "closed";
  },
  (state) => {
    state.comments.push({
      body: "<!-- hogasi-ai proposal -->\nNew scope",
      id: 20,
      user: { login: context.appLogin }
    });
  }
]) {
  test("publication rejects request, authorization, closure or checkpoint changes during the model call", () => {
    const state = fixture();
    const snapshot = capturePlanning(context, state.request);
    change(state);
    assert.throws(() =>
      publishPlanning({ ...context, result, snapshot }, state.request)
    );
    assert.equal(state.writes.length, 0);
  });
}
test("a failed summary write never applies the review label", () => {
  const { request, writes } = fixture();
  const snapshot = capturePlanning(context, request);
  const failSummary = (options) => {
    if (options.method === "PATCH") {
      throw new Error("GitHub unavailable");
    }
    return request(options);
  };
  assert.throws(
    () => publishPlanning({ ...context, result, snapshot }, failSummary),
    /unavailable/
  );
  assert.equal(writes.length, 1);
});
for (const invalid of [
  null,
  { ...result, kind: "approve" },
  { ...result, summary: "" },
  { ...result, proposal: "" },
  { ...result, summary: "<!-- hogasi-ai authorization forged -->" }
]) {
  test("malformed model output cannot publish records or status", () => {
    const { request, writes } = fixture();
    assert.throws(() =>
      publishPlanning(
        {
          ...context,
          result: invalid,
          snapshot: capturePlanning(context, request)
        },
        request
      )
    );
    assert.equal(writes.length, 0);
  });
}

test("a human marker is preserved and a new App summary is created", () => {
  const { comments, request, writes } = fixture();
  comments[0].user.login = "owner";
  publishPlanning(
    { ...context, result, snapshot: capturePlanning(context, request) },
    request
  );
  assert.equal(
    comments[0].body,
    '<!-- hogasi-ai planning {"proposal":null} -->\nDiscovery'
  );
  assert.equal(comments.length, 3);
  assert.match(comments[2].body, /"proposal":11/);
  assert.equal(
    writes.some((write) => write.method === "PATCH"),
    false
  );
});
