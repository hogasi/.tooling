import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { applyApproval } from "./approval.mjs";

const appLogin = "hogasi-ai[bot]";
const body = "## Proposal\nImplement the agreed feature.\n";
const digestOf = (value) => createHash("sha256").update(value).digest("hex");
const digest = digestOf(body);
const issue = {
  body,
  labels: [{ name: "ready" }, { name: "approved" }],
  number: 7
};
const context = {
  actor: "owner",
  appLogin,
  event: { action: "labeled", issue, label: { name: "approved" } },
  issueNumber: "7",
  mode: "verify",
  repository: "hogasi/sandbox",
  runId: "123",
  runUrl: "https://github.com/hogasi/sandbox/actions/runs/123"
};
const record = (overrides = {}) => ({
  body: `<!-- hogasi-ai approval sha256=${digest} run=100 -->`,
  id: 1,
  user: { login: appLogin },
  ...overrides
});

function fixture(overrides = {}) {
  const state = {
    issue,
    pages: [[record()]],
    permission: "write",
    ...overrides
  };
  const writes = [];
  const request = ({ body: payload, method = "GET", paginate, path }) => {
    if (method !== "GET") {
      writes.push({ body: payload, method, path });
      return {};
    }
    if (path.endsWith("/permission")) {
      return { permission: state.permission };
    }
    if (path.endsWith("/comments")) {
      assert.equal(paginate, true);
      return state.pages;
    }
    return state.issue;
  };
  return { request, writes };
}

test("records the exact approved event body including trailing newlines", () => {
  const { request, writes } = fixture({ pages: [[]] });
  assert.equal(applyApproval({ ...context, mode: "record" }, request), digest);
  assert.equal(writes.length, 1);
  assert.ok(writes[0].body.body.includes(`sha256=${digest} run=123`));
});

test("an old approval event cannot approve the current edited proposal", () => {
  const { request, writes } = fixture({
    issue: { ...issue, body: "Changed scope" }
  });
  assert.throws(
    () => applyApproval({ ...context, mode: "record" }, request),
    /changed/
  );
  assert.equal(writes.length, 0);
});

test("an approval event for another issue cannot record approval", () => {
  const { request, writes } = fixture();
  const event = { ...context.event, issue: { ...issue, number: 8 } };
  assert.throws(
    () => applyApproval({ ...context, event, mode: "record" }, request),
    /approval event/
  );
  assert.equal(writes.length, 0);
});

test("an ordinary event cannot be used to record approval", () => {
  const { request, writes } = fixture();
  const event = { ...context.event, action: "edited" };
  assert.throws(
    () => applyApproval({ ...context, event, mode: "record" }, request),
    /approval event/
  );
  assert.equal(writes.length, 0);
});

for (const mode of ["record", "verify", "clear"]) {
  test(`read-only access cannot ${mode} approval`, () => {
    const { request, writes } = fixture({ permission: "read" });
    assert.throws(
      () => applyApproval({ ...context, mode }, request),
      /write access/
    );
    assert.equal(writes.length, 0);
  });
}

for (const mode of ["record", "verify"]) {
  test(`${mode} rejects approval after the label is removed`, () => {
    const { request, writes } = fixture({
      issue: { ...issue, labels: [{ name: "ready" }] }
    });
    assert.throws(
      () => applyApproval({ ...context, mode }, request),
      /approved/
    );
    assert.equal(writes.length, 0);
  });
}

test("a cleared record on a later page revokes an earlier approval", () => {
  const pages = [
    [record()],
    [record({ body: "<!-- hogasi-ai approval cleared -->", id: 2 })]
  ];
  const { request } = fixture({ pages });
  assert.throws(() => applyApproval(context, request), /revoked/);
});

test("only the most recent approval across all pages is verified", () => {
  const pages = [
    [record({ body: `<!-- hogasi-ai approval sha256=${digestOf("old")} -->` })],
    [record({ id: 2 })]
  ];
  const { request } = fixture({ pages });
  assert.equal(applyApproval(context, request), digest);
});

test("a cleared record followed by renewed approval allows repairs", () => {
  const pages = [
    [record({ body: "<!-- hogasi-ai approval cleared -->" })],
    [record({ id: 2 })]
  ];
  const { request } = fixture({ pages });
  assert.equal(applyApproval(context, request), digest);
});

test("a human-authored marker cannot establish approval", () => {
  const { request } = fixture({
    pages: [[record({ user: { login: "owner" } })]]
  });
  assert.throws(() => applyApproval(context, request), /No approval/);
});

test("a malformed App marker fails closed instead of reviving an older approval", () => {
  const pages = [
    [record(), record({ body: "<!-- hogasi-ai approval broken -->", id: 2 })]
  ];
  const { request } = fixture({ pages });
  assert.throws(() => applyApproval(context, request), /Malformed approval/);
});

test("a changed body fails the recheck after a writer leaves the queue", () => {
  const initial = fixture();
  const expectedDigest = applyApproval(context, initial.request);
  const queued = fixture({ issue: { ...issue, body: "Changed while queued" } });
  assert.throws(
    () => applyApproval({ ...context, expectedDigest }, queued.request),
    /changed/
  );
});

test("a different newly approved proposal cannot replace the queued proposal", () => {
  const changedBody = "Newly approved scope";
  const pages = [
    [
      record({
        body: `<!-- hogasi-ai approval sha256=${digestOf(changedBody)} -->`
      })
    ]
  ];
  const { request } = fixture({
    issue: { ...issue, body: changedBody },
    pages
  });
  assert.throws(
    () => applyApproval({ ...context, expectedDigest: digest }, request),
    /queued/
  );
});

test("removing approval while queued prevents the implementation recheck", () => {
  const { request } = fixture({ issue: { ...issue, labels: [] } });
  assert.throws(
    () => applyApproval({ ...context, expectedDigest: digest }, request),
    /approved/
  );
});

test("a matching approval can be verified again without writes", () => {
  const { request, writes } = fixture();
  assert.equal(
    applyApproval({ ...context, expectedDigest: digest }, request),
    digest
  );
  assert.equal(writes.length, 0);
});

test("retrying the same recorded approval does not append another record", () => {
  const { request, writes } = fixture();
  assert.equal(applyApproval({ ...context, mode: "record" }, request), digest);
  assert.equal(writes.length, 0);
});

test("replanning removes the label and records revocation", () => {
  const { request, writes } = fixture();
  applyApproval({ ...context, mode: "clear" }, request);
  assert.equal(writes[0].method, "DELETE");
  assert.match(writes[0].path, /labels\/approved$/);
  assert.match(writes[1].body.body, /approval cleared/);
});

test("clearing an absent label still leaves an explicit revocation", () => {
  const { request, writes } = fixture({ issue: { ...issue, labels: [] } });
  applyApproval({ ...context, mode: "clear" }, request);
  assert.equal(writes.length, 1);
  assert.match(writes[0].body.body, /approval cleared/);
});

test("an API failure stops approval processing", () => {
  const request = () => {
    throw new Error("GitHub unavailable");
  };
  assert.throws(() => applyApproval(context, request), /GitHub unavailable/);
});

test("failed label removal does not report successful revocation", () => {
  const base = fixture();
  const request = (options) => {
    if (options.method === "DELETE") {
      throw new Error("GitHub refused deletion");
    }
    return base.request(options);
  };
  assert.throws(
    () => applyApproval({ ...context, mode: "clear" }, request),
    /refused deletion/
  );
  assert.equal(base.writes.length, 0);
});

test("malformed paginated comments fail closed", () => {
  const { request } = fixture({ pages: [{}] });
  assert.throws(() => applyApproval(context, request), /comment pages/);
});

test("malformed issue data fails closed", () => {
  const { request } = fixture({ issue: { ...issue, body: 42 } });
  assert.throws(() => applyApproval(context, request), /issue/);
});

test("invalid repository paths are rejected before GitHub is called", () => {
  const request = () => {
    assert.fail("Unexpected API call");
  };
  assert.throws(
    () => applyApproval({ ...context, repository: "../other" }, request),
    /repository/
  );
});
