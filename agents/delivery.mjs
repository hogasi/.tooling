import { applyApproval, readApprovedProposal } from "./approval.mjs";
import { requireDependencies } from "./delivery-evidence.mjs";
import { readDeliveryPlan } from "./delivery-plan.mjs";
import { refreshDelivery } from "./delivery-progress.mjs";
import { childBody, readChild, verifyInheritance } from "./delivery-scope.mjs";
import { githubRequest, readPages } from "./github.mjs";
import { latestComment, readComments } from "./proposal.mjs";

export function claimChildDiscovery(context, callGitHub = githubRequest) {
  const decision = resolveChildDiscovery(context, callGitHub);
  if (!decision.role) {
    return false;
  }
  const summary = latestComment({
    comments: readComments(context, callGitHub),
    login: context.appLogin,
    marker: "<!-- hogasi-ai planning "
  });
  if (summary) {
    return false;
  }
  callGitHub({
    body: {
      body: '<!-- hogasi-ai planning {"proposal":null} -->\nDiscovery started for the inherited child deliverable.'
    },
    method: "POST",
    path: `repos/${context.repository}/issues/${context.issueNumber}/comments`
  });
  return true;
}

export function createChildren(context, callGitHub = githubRequest) {
  const { issue, proposal } = readApprovedProposal(context, callGitHub);
  const definitions = readDeliveryPlan(proposal);
  if (definitions.length === 0) {
    requireDependencies(context, issue, callGitHub);
    return [];
  }
  const existing = readPages(
    `repos/${context.repository}/issues?state=all&since=${encodeURIComponent(proposal.createdAt)}&per_page=100`,
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
  verifyInheritance(context, issue, callGitHub);
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
      issue.body === body &&
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
