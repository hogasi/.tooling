import assert from "node:assert/strict";
import test from "node:test";

import {
  decide,
  resolveEffort,
  resolveEnabledRoles,
  resolveModel,
  resolveRoute,
  settingsFor
} from "./route.mjs";

const ownerEvent = (overrides) => ({
  action: "opened",
  appLogin: "hogasi-ai[bot]",
  associationSubject: "silviuhogasi",
  authorAssociation: "OWNER",
  commentBody: "",
  eventName: "issues",
  isPullRequest: false,
  labelName: "",
  labels: [],
  senderLogin: "silviuhogasi",
  senderType: "User",
  ...overrides
});

test("a new issue starts discovery", () => {
  const route = resolveRoute(ownerEvent({}));

  assert.equal(route.role, "planner");
  assert.equal(route.approval, "none");
});

test("an owner comment during discovery continues planning", () => {
  const route = resolveRoute(
    ownerEvent({
      action: "created",
      commentBody: "Q1: yes",
      eventName: "issue_comment"
    })
  );

  assert.equal(route.role, "planner");
});

test("an ordinary comment on an approved issue starts nothing", () => {
  const route = resolveRoute(
    ownerEvent({
      action: "created",
      commentBody: "looks good",
      eventName: "issue_comment",
      labels: ["ready", "reviewed", "ready for dev"]
    })
  );

  assert.equal(route.role, "");
});

test("@claude replan clears the approval and returns to discovery", () => {
  const route = resolveRoute(
    ownerEvent({
      action: "created",
      commentBody: "@claude replan — the scope changed",
      eventName: "issue_comment",
      labels: ["ready", "reviewed", "ready for dev"]
    })
  );

  assert.equal(route.role, "planner");
  assert.equal(route.approval, "clear");
});

test("approving a reviewed proposal records the approval and implements", () => {
  const route = resolveRoute(
    ownerEvent({
      action: "labeled",
      labelName: "ready for dev",
      labels: ["ready", "reviewed", "ready for dev"]
    })
  );

  assert.equal(route.role, "implementer");
  assert.equal(route.approval, "record");
});

test("approving a proposal that is not reviewed fails loudly", () => {
  assert.throws(
    () =>
      resolveRoute(
        ownerEvent({
          action: "labeled",
          labelName: "ready for dev",
          labels: ["ready for dev"]
        })
      ),
    /ready/
  );
});

test("any other label starts nothing", () => {
  const route = resolveRoute(
    ownerEvent({ action: "labeled", labelName: "bug", labels: ["bug"] })
  );

  assert.equal(route.role, "");
});

test("editing an approved proposal clears the approval without running a role", () => {
  const route = resolveRoute(
    ownerEvent({
      action: "edited",
      labels: ["ready", "reviewed", "ready for dev"]
    })
  );

  assert.equal(route.role, "");
  assert.equal(route.approval, "clear");
});

test("editing an unapproved issue changes nothing", () => {
  const route = resolveRoute(
    ownerEvent({ action: "edited", labels: ["ready"] })
  );

  assert.equal(route.approval, "none");
});

test("@claude on the pull request starts a repair that reverifies approval", () => {
  const route = resolveRoute(
    ownerEvent({
      action: "created",
      commentBody: "@claude the build is red",
      eventName: "issue_comment",
      isPullRequest: true
    })
  );

  assert.equal(route.role, "implementer");
  assert.equal(route.approval, "verify");
});

test("a pull request comment without the trigger phrase starts nothing", () => {
  const route = resolveRoute(
    ownerEvent({
      action: "created",
      commentBody: "merging this tomorrow",
      eventName: "issue_comment",
      isPullRequest: true
    })
  );

  assert.equal(route.role, "");
});

test("bots never invoke a role", () => {
  const route = resolveRoute(
    ownerEvent({
      action: "created",
      commentBody: "@claude fix the failures",
      eventName: "issue_comment",
      isPullRequest: true,
      senderLogin: "codex[bot]",
      senderType: "Bot"
    })
  );

  assert.equal(route.role, "");
  assert.match(route.reason, /not a human account/);
});

test("a bot account posting as a User still never invokes a role", () => {
  // The App pushes and opens pull requests, so its own comments arrive as
  // events. Only the login marks them, not the sender type.
  const route = resolveRoute(
    ownerEvent({ senderLogin: "hogasi-ai[bot]", senderType: "User" })
  );

  assert.equal(route.role, "");
});

test("a quoted mention does not start a repair", () => {
  const route = resolveRoute(
    ownerEvent({
      action: "created",
      commentBody: "> @claude the build is red\n\nIgnore that, it was flaky.",
      eventName: "issue_comment",
      isPullRequest: true
    })
  );

  assert.equal(route.role, "");
});

test("a quoted replan request does not clear the approval", () => {
  const route = resolveRoute(
    ownerEvent({
      action: "created",
      commentBody: "> @claude replan\n\nI decided against that.",
      eventName: "issue_comment",
      labels: ["ready", "reviewed", "ready for dev"]
    })
  );

  assert.equal(route.approval, "none");
});

test("an edited pull request comment starts nothing", () => {
  const route = resolveRoute(
    ownerEvent({
      action: "edited",
      commentBody: "@claude fix the build",
      eventName: "issue_comment",
      isPullRequest: true
    })
  );

  assert.equal(route.role, "");
});

test("an association describing someone other than the sender is not trusted", () => {
  const route = resolveRoute(
    ownerEvent({
      action: "edited",
      associationSubject: "a-stranger",
      labels: ["ready", "reviewed", "ready for dev"]
    })
  );

  assert.equal(route.role, "");
  assert.match(route.reason, /no author_association/);
});

test("an owner may approve an outside contributor's issue", () => {
  // Only triage access or better can apply a label, and the approval job reads
  // the labeller's real permission back. The issue opener's association says
  // nothing about who labelled it.
  const route = resolveRoute(
    ownerEvent({
      action: "labeled",
      associationSubject: "a-stranger",
      authorAssociation: "NONE",
      labelName: "ready for dev",
      labels: ["ready", "reviewed", "ready for dev"]
    })
  );

  assert.equal(route.role, "implementer");
  assert.equal(route.approval, "record");
});

test("a drive-by contributor never invokes a role", () => {
  const route = resolveRoute(ownerEvent({ authorAssociation: "NONE" }));

  assert.equal(route.role, "");
  assert.match(route.reason, /no write relationship/);
});

test("an unrouted event type starts nothing", () => {
  const route = resolveRoute(ownerEvent({ action: "closed" }));

  assert.equal(route.role, "");
});

test("unset AI_ROLES disables every role", () => {
  const decision = decide({ EVENT_ACTION: "opened", EVENT_NAME: "issues" });

  assert.equal(decision.role, "");
});

test("AI_ROLES enrolls one role at a time", () => {
  const environment = {
    AI_ROLES: "planner",
    EVENT_ACTION: "labeled",
    EVENT_ASSOCIATION_SUBJECT: "silviuhogasi",
    EVENT_AUTHOR_ASSOCIATION: "OWNER",
    EVENT_LABEL: "ready for dev",
    EVENT_LABELS: '["ready","reviewed","ready for dev"]',
    EVENT_NAME: "issues",
    EVENT_SENDER: "silviuhogasi",
    EVENT_SENDER_TYPE: "User"
  };

  assert.equal(decide(environment).role, "");
  assert.equal(
    decide({ ...environment, AI_ROLES: "planner,implementer" }).role,
    "implementer"
  );
});

test("an approval-clearing edit is gated on the implementer being enabled", () => {
  const environment = {
    EVENT_ACTION: "edited",
    EVENT_ASSOCIATION_SUBJECT: "silviuhogasi",
    EVENT_AUTHOR_ASSOCIATION: "OWNER",
    EVENT_LABELS: '["ready","reviewed","ready for dev"]',
    EVENT_NAME: "issues",
    EVENT_SENDER: "silviuhogasi",
    EVENT_SENDER_TYPE: "User"
  };

  assert.equal(
    decide({ ...environment, AI_ROLES: "planner" }).approval,
    "none"
  );
  assert.equal(
    decide({ ...environment, AI_ROLES: "planner,implementer" }).approval,
    "clear"
  );
});

test("roles are read as a trimmed comma list", () => {
  assert.deepEqual(
    [...resolveEnabledRoles(" planner , implementer ,")],
    ["planner", "implementer"]
  );
});

test("a variable holding only separators enables nothing", () => {
  assert.equal(resolveEnabledRoles(" , , ").size, 0);
});

test("the workflow default is used when no variable overrides it", () => {
  assert.equal(resolveModel({ fallback: "fable", override: "" }), "fable");
  assert.equal(
    resolveEffort({ fallback: "high", override: undefined }),
    "high"
  );
});

test("an override selects an alias or an explicit model id", () => {
  assert.equal(resolveModel({ fallback: "fable", override: "opus" }), "opus");
  assert.equal(
    resolveModel({ fallback: "fable", override: "claude-fable-5" }),
    "claude-fable-5"
  );
  assert.equal(
    resolveModel({ fallback: "opus", override: "claude-opus-5[1m]" }),
    "claude-opus-5[1m]"
  );
});

test("an unrecognised model fails rather than reaching the command line", () => {
  assert.throws(
    () => resolveModel({ fallback: "fable", override: "gpt-6" }),
    /Unsupported Claude model/
  );
  assert.throws(
    () => resolveModel({ fallback: "fable", override: "opus; rm -rf /" }),
    /Unsupported Claude model/
  );
});

test("an unrecognised effort fails rather than reaching the command line", () => {
  assert.throws(
    () => resolveEffort({ fallback: "high", override: "maximum" }),
    /Unsupported Claude effort/
  );
});

test("ultracode is not an accepted effort for an unattended run", () => {
  assert.throws(
    () => resolveEffort({ fallback: "high", override: "ultracode" }),
    /Unsupported Claude effort/
  );
});

test("each role falls back to the workflow default for its own model", () => {
  const defaults = {
    AI_DEFAULT_EFFORT: "high",
    AI_DEFAULT_IMPLEMENTER_MODEL: "opus",
    AI_DEFAULT_PLANNER_MODEL: "fable"
  };

  assert.deepEqual(settingsFor("planner", defaults), {
    effort: "high",
    model: "fable"
  });
  assert.deepEqual(settingsFor("implementer", defaults), {
    effort: "high",
    model: "opus"
  });
});

test("a repository variable overrides only its own role", () => {
  const settings = settingsFor("planner", {
    AI_DEFAULT_EFFORT: "high",
    AI_DEFAULT_PLANNER_MODEL: "fable",
    AI_IMPLEMENTER_MODEL: "sonnet",
    AI_PLANNER_EFFORT: "max",
    AI_PLANNER_MODEL: "claude-fable-5"
  });

  assert.deepEqual(settings, { effort: "max", model: "claude-fable-5" });
});

test("no role means no model to resolve", () => {
  assert.deepEqual(settingsFor("", {}), { effort: "", model: "" });
});

test("an admin reported as CONTRIBUTOR can start planner-only discovery", () => {
  const decision = decide({
    AI_ROLES: "planner",
    EVENT_ACTION: "opened",
    EVENT_ASSOCIATION_SUBJECT: "silviuhogasi",
    EVENT_AUTHOR_ASSOCIATION: "CONTRIBUTOR",
    EVENT_NAME: "issues",
    EVENT_SENDER: "silviuhogasi",
    EVENT_SENDER_PERMISSION: "admin",
    EVENT_SENDER_TYPE: "User"
  });

  assert.equal(decision.role, "planner");
  assert.equal(decision.reason, "a new issue starts discovery");
});

for (const senderPermission of ["read", "triage", "none", "", "unknown"]) {
  test(`${senderPermission || "missing"} permission cannot use MEMBER association to start discovery`, () => {
    const decision = resolveRoute(
      ownerEvent({ authorAssociation: "MEMBER", senderPermission })
    );
    assert.equal(decision.role, "");
    assert.match(decision.reason, /write access/);
  });
}

test("a rejected sender keeps the authorization reason in planner-only mode", () => {
  const decision = decide({
    AI_ROLES: "planner",
    EVENT_ACTION: "opened",
    EVENT_ASSOCIATION_SUBJECT: "reader",
    EVENT_AUTHOR_ASSOCIATION: "MEMBER",
    EVENT_NAME: "issues",
    EVENT_SENDER: "reader",
    EVENT_SENDER_PERMISSION: "read",
    EVENT_SENDER_TYPE: "User"
  });
  assert.match(decision.reason, /write access/);
  assert.doesNotMatch(decision.reason, /AI_ROLES/);
});

test("an ignored event keeps its original reason in planner-only mode", () => {
  const decision = decide({
    AI_ROLES: "planner",
    EVENT_ACTION: "created",
    EVENT_ASSOCIATION_SUBJECT: "silviuhogasi",
    EVENT_AUTHOR_ASSOCIATION: "OWNER",
    EVENT_COMMENT_BODY: "looks good",
    EVENT_LABELS: '["ready","reviewed","ready for dev"]',
    EVENT_NAME: "issue_comment",
    EVENT_SENDER: "silviuhogasi",
    EVENT_SENDER_PERMISSION: "admin",
    EVENT_SENDER_TYPE: "User"
  });
  assert.match(decision.reason, /ordinary comment restarts nothing/);
});

test("the ready label sends the proposal to review", () => {
  const route = resolveRoute(
    ownerEvent({ action: "labeled", labelName: "ready", labels: ["ready"] })
  );

  assert.equal(route.role, "reviewer");
  assert.equal(route.approval, "none");
});

test("the planner's own ready label starts a review", () => {
  // The one bot event that starts a role. The planner applies `ready` as the
  // App, and a review that only a human could start would never run.
  const route = resolveRoute(
    ownerEvent({
      action: "labeled",
      labelName: "ready",
      labels: ["ready"],
      senderLogin: "hogasi-ai[bot]",
      senderType: "Bot"
    })
  );

  assert.equal(route.role, "reviewer");
});

test("re-adding ready reviews the revised proposal again", () => {
  const route = resolveRoute(
    ownerEvent({
      action: "labeled",
      labelName: "ready",
      labels: ["ready"],
      senderLogin: "hogasi-ai[bot]",
      senderType: "Bot"
    })
  );

  assert.equal(route.role, "reviewer");
});

test("the App gets no other exemption from the bot rule", () => {
  const route = resolveRoute(
    ownerEvent({
      action: "labeled",
      labelName: "reviewed",
      labels: ["ready", "reviewed"],
      senderLogin: "hogasi-ai[bot]",
      senderType: "Bot"
    })
  );

  assert.equal(route.role, "");
  assert.match(route.reason, /not a human account/);
});

test("another bot cannot start a review by labelling", () => {
  const route = resolveRoute(
    ownerEvent({
      action: "labeled",
      labelName: "ready",
      labels: ["ready"],
      senderLogin: "codex[bot]",
      senderType: "Bot"
    })
  );

  assert.equal(route.role, "");
  assert.match(route.reason, /not a human account/);
});

test("the reviewed label on its own starts nothing", () => {
  const route = resolveRoute(
    ownerEvent({
      action: "labeled",
      labelName: "reviewed",
      labels: ["ready", "reviewed"]
    })
  );

  assert.equal(route.role, "");
});

test("approving a proposal the reviewer has not passed fails loudly", () => {
  assert.throws(
    () =>
      resolveRoute(
        ownerEvent({
          action: "labeled",
          labelName: "ready for dev",
          labels: ["ready", "ready for dev"]
        })
      ),
    /reviewed/
  );
});

test("the reviewer is enrolled separately from the planner", () => {
  const environment = {
    AI_ROLES: "planner",
    EVENT_ACTION: "labeled",
    EVENT_ASSOCIATION_SUBJECT: "silviuhogasi",
    EVENT_AUTHOR_ASSOCIATION: "OWNER",
    EVENT_LABEL: "ready",
    EVENT_LABELS: '["ready"]',
    EVENT_NAME: "issues",
    EVENT_SENDER: "silviuhogasi",
    EVENT_SENDER_TYPE: "User"
  };

  assert.equal(decide(environment).role, "");
  assert.equal(
    decide({ ...environment, AI_ROLES: "planner,reviewer" }).role,
    "reviewer"
  );
});

test("the reviewer resolves its own model and effort", () => {
  assert.deepEqual(
    settingsFor("reviewer", {
      AI_DEFAULT_EFFORT: "high",
      AI_DEFAULT_REVIEWER_MODEL: "opus",
      AI_REVIEWER_EFFORT: "max"
    }),
    { effort: "max", model: "opus" }
  );
});
