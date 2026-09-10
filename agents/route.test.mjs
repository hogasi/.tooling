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
      labels: ["in review", "approved", "ready for dev"]
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
      labels: ["in review", "approved", "ready for dev"]
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
      labels: ["in review", "approved", "ready for dev"]
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
    /approved/
  );
});

test("any other label starts nothing", () => {
  const route = resolveRoute(
    ownerEvent({ action: "labeled", labelName: "bug", labels: ["bug"] })
  );

  assert.equal(route.role, "");
});

test("editing the original request does not change checkpoint approval", () => {
  const route = resolveRoute(
    ownerEvent({
      action: "edited",
      labels: ["in review", "approved", "ready for dev"]
    })
  );

  assert.equal(route.role, "");
  assert.equal(route.approval, "none");
});

test("editing an unapproved issue changes nothing", () => {
  const route = resolveRoute(
    ownerEvent({ action: "edited", labels: ["in review"] })
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
      labels: ["in review", "approved", "ready for dev"]
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
      labels: ["in review", "approved", "ready for dev"],
      senderPermission: "admin"
    })
  );

  assert.equal(route.role, "");
  assert.match(route.reason, /does not establish write authority/);
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
      labels: ["in review", "approved", "ready for dev"],
      senderPermission: "admin"
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
    EVENT_LABELS: '["in review","approved","ready for dev"]',
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

test("editing original request never schedules approval work", () => {
  const environment = {
    EVENT_ACTION: "edited",
    EVENT_ASSOCIATION_SUBJECT: "silviuhogasi",
    EVENT_AUTHOR_ASSOCIATION: "OWNER",
    EVENT_LABELS: '["in review","approved","ready for dev"]',
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
    "none"
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
    EVENT_LABELS: '["in review","approved","ready for dev"]',
    EVENT_NAME: "issue_comment",
    EVENT_SENDER: "silviuhogasi",
    EVENT_SENDER_PERMISSION: "admin",
    EVENT_SENDER_TYPE: "User"
  });
  assert.match(decision.reason, /ordinary comment restarts nothing/);
});

test("the ready label sends the proposal to review", () => {
  const route = resolveRoute(
    ownerEvent({
      action: "labeled",
      labelName: "in review",
      labels: ["in review"]
    })
  );

  assert.equal(route.role, "plan-reviewer");
  assert.equal(route.approval, "none");
});

test("the planner's own ready label starts a review", () => {
  // The one bot event that starts a role. The planner applies `ready` as the
  // App, and a review that only a human could start would never run.
  const route = resolveRoute(
    ownerEvent({
      action: "labeled",
      labelName: "in review",
      labels: ["in review"],
      senderLogin: "hogasi-ai[bot]",
      senderType: "Bot"
    })
  );

  assert.equal(route.role, "plan-reviewer");
});

test("re-adding ready reviews the revised proposal again", () => {
  const route = resolveRoute(
    ownerEvent({
      action: "labeled",
      labelName: "in review",
      labels: ["in review"],
      senderLogin: "hogasi-ai[bot]",
      senderType: "Bot"
    })
  );

  assert.equal(route.role, "plan-reviewer");
});

test("the App gets no other exemption from the bot rule", () => {
  const route = resolveRoute(
    ownerEvent({
      action: "labeled",
      labelName: "approved",
      labels: ["in review", "approved"],
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
      labelName: "in review",
      labels: ["in review"],
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
      labelName: "approved",
      labels: ["in review", "approved"]
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
          labels: ["in review", "ready for dev"]
        })
      ),
    /approved/
  );
});

test("the plan reviewer is enrolled separately from the planner", () => {
  const environment = {
    AI_ROLES: "planner",
    EVENT_ACTION: "labeled",
    EVENT_ASSOCIATION_SUBJECT: "silviuhogasi",
    EVENT_AUTHOR_ASSOCIATION: "OWNER",
    EVENT_LABEL: "in review",
    EVENT_LABELS: '["in review"]',
    EVENT_NAME: "issues",
    EVENT_SENDER: "silviuhogasi",
    EVENT_SENDER_TYPE: "User"
  };

  assert.equal(decide(environment).role, "");
  assert.equal(
    decide({ ...environment, AI_ROLES: "planner,plan-reviewer" }).role,
    "plan-reviewer"
  );
});

test("the plan reviewer resolves its own model and effort", () => {
  assert.deepEqual(
    settingsFor("plan-reviewer", {
      AI_DEFAULT_EFFORT: "high",
      AI_PLAN_REVIEWER_EFFORT: "low"
    }),
    { effort: "low", model: "gpt-6-astra" }
  );
});

for (const overrides of [
  { AI_PLAN_REVIEWER_MODEL: "opus" },
  { AI_PLAN_REVIEWER_EFFORT: "high" },
  { AI_PLAN_REVIEWER_MODEL: "gpt-6-astra\nmalicious" }
]) {
  test(`rejects unsupported review settings ${JSON.stringify(overrides)}`, () => {
    assert.throws(
      () => settingsFor("plan-reviewer", overrides),
      /Unsupported Codex/
    );
  });
}
test("review defaults to Astra medium", () => {
  assert.deepEqual(settingsFor("plan-reviewer", {}), {
    effort: "medium",
    model: "gpt-6-astra"
  });
});
test("a reader cannot request review on another author's issue", () => {
  const decision = resolveRoute(
    ownerEvent({
      action: "labeled",
      labelName: "in review",
      senderLogin: "reader",
      senderPermission: "read"
    })
  );
  assert.equal(decision.role, "");
});

const implementationPull = {
  base: { ref: "main", repo: { full_name: "hogasi/sandbox" } },
  draft: false,
  head: { ref: "claude/issue-9", repo: { full_name: "hogasi/sandbox" } },
  state: "open",
  user: { login: "hogasi-ai[bot]" }
};
const pullEvent = (overrides = {}) => ({
  action: "opened",
  appLogin: "hogasi-ai[bot]",
  defaultBranch: "main",
  eventName: "pull_request_target",
  pullRequest: implementationPull,
  repository: "hogasi/sandbox",
  senderLogin: "hogasi-ai[bot]",
  senderType: "Bot",
  ...overrides
});
for (const action of ["opened", "ready_for_review", "synchronize"]) {
  test(`the implementation App's ${action} event requests PR review`, () => {
    const decision = resolveRoute(pullEvent({ action }));
    assert.equal(decision.role, "pr-reviewer");
    assert.equal(decision.issue, "9");
    assert.equal(decision.approval, "none");
  });
}
for (const pullRequest of [
  { ...implementationPull, draft: true },
  { ...implementationPull, state: "closed" },
  { ...implementationPull, user: { login: "owner" } },
  {
    ...implementationPull,
    head: { ...implementationPull.head, repo: { full_name: "outside/fork" } }
  },
  {
    ...implementationPull,
    head: { ...implementationPull.head, ref: "unrelated" }
  },
  {
    ...implementationPull,
    base: { ...implementationPull.base, ref: "release" }
  }
]) {
  test(`ignores ineligible PR ${JSON.stringify(pullRequest)}`, () => {
    assert.equal(resolveRoute(pullEvent({ pullRequest })).role, "");
  });
}
for (const sender of [
  { senderLogin: "other[bot]", senderType: "Bot" },
  { senderLogin: "reader", senderPermission: "read", senderType: "User" }
]) {
  test(`denies PR review from ${sender.senderLogin}`, () => {
    assert.equal(resolveRoute(pullEvent(sender)).role, "");
  });
}
test("an owner with write permission can mark the App PR ready for review", () => {
  assert.equal(
    resolveRoute(
      pullEvent({
        action: "ready_for_review",
        senderLogin: "owner",
        senderPermission: "write",
        senderType: "User"
      })
    ).role,
    "pr-reviewer"
  );
});
test("untrusted PR events and review comments never trigger automatic repairs", () => {
  assert.equal(resolveRoute(pullEvent({ eventName: "pull_request" })).role, "");
  assert.equal(
    resolveRoute(
      pullEvent({ action: "submitted", eventName: "pull_request_review" })
    ).role,
    ""
  );
});
test("PR review has independent Astra medium settings", () => {
  assert.deepEqual(
    settingsFor("pr-reviewer", { AI_PLAN_REVIEWER_EFFORT: "low" }),
    { effort: "medium", model: "gpt-6-astra" }
  );
  assert.deepEqual(
    settingsFor("pr-reviewer", { AI_PR_REVIEWER_EFFORT: "low" }),
    { effort: "low", model: "gpt-6-astra" }
  );
  assert.throws(
    () => settingsFor("pr-reviewer", { AI_PR_REVIEWER_MODEL: "opus" }),
    /Unsupported Codex/
  );
});

test("PR review remains disabled unless explicitly enrolled", () => {
  const environment = {
    AI_ROLES: "planner,plan-reviewer,implementer",
    APP_LOGIN: "hogasi-ai[bot]",
    EVENT_ACTION: "opened",
    EVENT_DEFAULT_BRANCH: "main",
    EVENT_NAME: "pull_request_target",
    EVENT_PULL_REQUEST: JSON.stringify(implementationPull),
    EVENT_SENDER: "hogasi-ai[bot]",
    EVENT_SENDER_TYPE: "Bot",
    GITHUB_REPOSITORY: "hogasi/sandbox"
  };
  assert.equal(decide(environment).role, "");
  assert.equal(
    decide({ ...environment, AI_ROLES: "pr-reviewer" }).role,
    "pr-reviewer"
  );
});
