import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { applyApproval, readApprovedProposal } from "./approval.mjs";

const appLogin = "hogasi-ai[bot]";
const body = "## Proposal\nImplement the agreed feature.\n";
const digestOf = (value) => createHash("sha256").update(value).digest("hex");
const digest = digestOf(body);
const issue = {
  body,
  labels: [{ name: "ready" }, { name: "reviewed" }, { name: "ready for dev" }],
  number: 7
};
const context = {
  actor: "owner",
  appLogin,
  event: { action: "labeled", issue, label: { name: "ready for dev" } },
  issueNumber: "7",
  mode: "verify",
  repository: "hogasi/sandbox",
  reviewerLogin: "hogasi-review[bot]",
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
  const reviewRecords = state.reviewRecords ?? [
    {
      body: `<!-- hogasi-review plan ${JSON.stringify({ digest: digestOf(state.issue.body), run: "100.1", sha: "a".repeat(40), status: "pass" })} -->`,
      id: 900,
      user: { login: context.reviewerLogin }
    }
  ];
  const reads = new Map([
    ["repos/hogasi/sandbox", () => ({ default_branch: "main" })],
    [
      "repos/hogasi/sandbox/collaborators/owner/permission",
      () => ({ permission: state.permission })
    ],
    ["repos/hogasi/sandbox/commits/main", () => ({ sha: "a".repeat(40) })],
    ["repos/hogasi/sandbox/issues/7", () => state.issue],
    [
      "repos/hogasi/sandbox/issues/7/comments",
      ({ paginate }) => {
        assert.equal(paginate, true);
        return [...state.pages, reviewRecords];
      }
    ]
  ]);
  const request = (options) => {
    if (options.method && options.method !== "GET") {
      writes.push(options);
      return {};
    }
    return reads.get(options.path)(options);
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
      issue: { ...issue, labels: [{ name: "ready" }, { name: "reviewed" }] }
    });
    assert.throws(
      () => applyApproval({ ...context, mode }, request),
      /ready for dev/
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
    /ready for dev/
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

test("an unreviewed proposal cannot be approved", () => {
  const { request } = fixture({
    issue: { ...issue, labels: [{ name: "ready" }, { name: "ready for dev" }] }
  });
  assert.throws(
    () => applyApproval({ ...context, mode: "record" }, request),
    /reviewed/
  );
});

test("replanning removes the label and records revocation", () => {
  const { request, writes } = fixture();
  applyApproval({ ...context, mode: "clear" }, request);
  assert.equal(writes[0].method, "DELETE");
  assert.match(writes[0].path, /labels\/ready%20for%20dev$/);
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
  const { request } = fixture({
    issue: { ...issue, body: 42 },
    reviewRecords: []
  });
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

for (const mode of ["record", "verify"]) {
  test(`${mode} rejects forged reviewed labels without a reviewer record`, () => {
    const { request, writes } = fixture({ reviewRecords: [] });
    assert.throws(
      () => applyApproval({ ...context, mode }, request),
      /current passing/
    );
    assert.equal(writes.length, 0);
  });
}

test("PR review reads owner approval without minting implementation authority", () => {
  const { request, writes } = fixture({ issue: { ...issue, state: "open" } });
  const proposal = readApprovedProposal(context, request);
  assert.equal(proposal.digest, digest);
  assert.equal(proposal.issue.body, issue.body);
  assert.equal(writes.length, 0);
});
test("PR review rejects a revoked proposal", () => {
  const { request } = fixture({
    issue: { ...issue, state: "open" },
    pages: [[record({ body: "<!-- hogasi-ai approval cleared -->" })]]
  });
  assert.throws(() => readApprovedProposal(context, request), /revoked/);
});
test("PR review rejects a human-authored approval marker", () => {
  const { request } = fixture({
    issue: { ...issue, state: "open" },
    pages: [[record({ user: { login: "owner" } })]]
  });
  assert.throws(() => readApprovedProposal(context, request), /No approval/);
});
