import { applyApproval, readApprovedProposal } from "./approval.mjs";
import { readDeliveryPlan } from "./delivery-plan.mjs";
import { refreshDelivery } from "./delivery-progress.mjs";
import {
  appendInheritance,
  childBody,
  readChild,
  readInheritance
} from "./delivery-scope.mjs";
import { githubRequest, readPages } from "./github.mjs";
import { latestComment, readComments } from "./proposal.mjs";

export function claimChildDiscovery(context, callGitHub = githubRequest) {
  if (!resolveChildDiscovery(context, callGitHub).role) {
    return false;
  }
  const issue = callGitHub({
    path: `repos/${context.repository}/issues/${context.issueNumber}`
  });
  const scope = appendInheritance(
    "",
    readInheritance(context, issue, callGitHub)
  );
  const comments = readComments(context, callGitHub);
  const authored = { comments, login: context.appLogin };
  const summary = latestComment({
    ...authored,
    marker: "<!-- hogasi-ai planning "
  });
  const checkpoint = latestComment({
    ...authored,
    marker: "<!-- hogasi-ai proposal -->"
  });
  if (
    checkpoint?.body.endsWith(scope) ||
    summary?.body.includes(JSON.stringify({ discovery: scope }))
  ) {
    return false;
  }
  claimChildScope(context, { checkpoint, issue, scope, summary }, callGitHub);
  return true;
}

export function createChildren(context, callGitHub = githubRequest) {
  const { proposal } = readApprovedProposal(context, callGitHub);
  const definitions = readDeliveryPlan(proposal);
  if (definitions.length === 0) {
    return [];
  }
  const existing = readPages(
    `repos/${context.repository}/issues?state=all&per_page=100`,
    callGitHub
  );
  const children = definitions.map((child) =>
    ensureChild(context, { child, existing, proposal }, callGitHub)
  );
  linkChildren(context, { children, definitions }, callGitHub);
  refreshDelivery(context, callGitHub);
  return children;
}

export function resolveChildDiscovery(context, callGitHub = githubRequest) {
  if (
    context.senderLogin !== context.appLogin ||
    !/^[1-9]\d*$/.test(context.sourceRunId) ||
    !/^[1-9]\d*$/.test(context.issueNumber)
  ) {
    throw new Error("Untrusted child discovery event");
  }
  const issue = callGitHub({
    path: `repos/${context.repository}/issues/${context.issueNumber}`
  });
  const child = readChild(issue, context.appLogin);
  if (!child || issue.state !== "open") {
    return {
      approval: "none",
      role: ""
    };
  }
  readInheritance(context, issue, callGitHub);
  requireChildSource(context, child.parent, callGitHub);
  return {
    approval: "none",
    automatic: "true",
    discovery: "true",
    issue: context.issueNumber,
    reason: "clarify an authorized child deliverable",
    role: "planner",
    source: context.sourceRunId
  };
}

function claimChildScope(
  context,
  { checkpoint, issue, scope, summary },
  callGitHub
) {
  if (issue.labels.some((label) => label.name === "ready for dev")) {
    callGitHub({
      method: "DELETE",
      path: `repos/${context.repository}/issues/${context.issueNumber}/labels/ready%20for%20dev`
    });
  }
  const record = { proposal: checkpoint?.id ?? null };
  const body = `<!-- hogasi-ai planning ${JSON.stringify(record)} -->\n<!-- hogasi-ai ${JSON.stringify({ discovery: scope })} -->\nDiscovery started for the current approved parent deliverable. Existing implementation requires a newly reviewed child checkpoint and owner authorization.`;
  callGitHub({
    body: { body },
    method: summary ? "PATCH" : "POST",
    path: summary
      ? `repos/${context.repository}/issues/comments/${summary.id}`
      : `repos/${context.repository}/issues/${context.issueNumber}/comments`
  });
}

function createChildIssue(context, { body, child }, callGitHub) {
  const created = callGitHub({
    body: { body, title: child.title },
    method: "POST",
    path: `repos/${context.repository}/issues`
  });
  if (
    !Number.isSafeInteger(created?.id) ||
    !Number.isSafeInteger(created.number)
  ) {
    throw new TypeError("GitHub did not return a child issue");
  }
  return { ...created, key: child.key };
}

function ensureChild(context, { child, existing, proposal }, callGitHub) {
  const body = childBody(context, { child, proposal });
  const matches = existing.filter(
    (issue) =>
      issue.user?.login === context.appLogin &&
      readChild(issue, context.appLogin)?.parent ===
        Number(context.issueNumber) &&
      readChild(issue, context.appLogin)?.key === child.key &&
      !issue.pull_request
  );
  if (matches.length > 1) {
    throw new Error("Duplicate child issues require reconciliation");
  }
  if (matches[0]) {
    if (
      matches[0].state === "closed" &&
      matches[0].state_reason !== "completed"
    ) {
      throw new Error(
        "A child was closed without delivery; update the parent plan"
      );
    }
    return { ...matches[0], key: child.key };
  }
  return createChildIssue(context, { body, child }, callGitHub);
}

function linkChildren(context, { children, definitions }, callGitHub) {
  const root = `repos/${context.repository}/issues/${context.issueNumber}/sub_issues`;
  const linked = readPages(root, callGitHub);
  for (const child of children) {
    if (linked.every((issue) => issue.id !== child.id)) {
      callGitHub({
        body: { sub_issue_id: child.id },
        method: "POST",
        path: root
      });
    }
    const definition = definitions.find((entry) => entry.key === child.key);
    const dependencies = readPages(
      `repos/${context.repository}/issues/${child.number}/dependencies/blocked_by`,
      callGitHub
    );
    for (const key of definition.dependsOn) {
      const blocker = children.find((entry) => entry.key === key);
      if (dependencies.every((issue) => issue.id !== blocker.id)) {
        callGitHub({
          body: { issue_id: blocker.id },
          method: "POST",
          path: `repos/${context.repository}/issues/${child.number}/dependencies/blocked_by`
        });
      }
    }
  }
}

function requireChildSource(context, parentNumber, callGitHub) {
  const run = callGitHub({
    path: `repos/${context.repository}/actions/runs/${context.sourceRunId}`
  });
  if (
    run.path !== ".github/workflows/ai.yml" ||
    !["issue_comment", "issues"].includes(run.event)
  ) {
    throw new Error("Untrusted child creation source");
  }
  applyApproval(
    {
      ...context,
      actor: run.actor.login,
      issueNumber: String(parentNumber),
      mode: "verify"
    },
    callGitHub
  );
}
