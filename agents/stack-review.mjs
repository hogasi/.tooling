import { githubRequest, readPages } from "./github.mjs";
import { parentDeliveries } from "./parent-integration.mjs";
import { pullRequestIssue } from "./pull-request.mjs";
import { readRepairCi } from "./repair-evidence.mjs";
import { deliveryTarget } from "./stack-target.mjs";

export function parentIntegrationRoute(context, callGitHub = githubRequest) {
  const run = readRun(context, callGitHub);
  const issue = parentRunIssue(context, run);
  if (!issue) {
    return null;
  }
  const branch = callGitHub({
    path: `repos/${context.repository}/git/ref/heads/${run.head_branch}`
  });
  if (branch.object.sha !== run.head_sha) {
    return null;
  }
  const scope = { ...context, issueNumber: issue };
  const state = parentDeliveries(scope, callGitHub);
  if (
    state.deliveries.length === 0 ||
    (run.event === "pull_request" && run.conclusion !== "success")
  ) {
    return null;
  }
  return {
    approval: "none",
    issue,
    reason: "refresh current parent integration after CI",
    role: "delivery-tracker",
    source: context.sourceRunId,
    stack_pull: mergedStackPull(context, run, callGitHub)
  };
}

export function readStackReviewSource(context, callGitHub = githubRequest) {
  const run = readRun(context, callGitHub);
  if (!isCurrentCiSource(context, run)) {
    return null;
  }
  const pull = callGitHub({
    path: `repos/${context.repository}/pulls/${run.pull_requests[0].number}`
  });
  if (pull.head.sha !== run.head_sha) {
    return null;
  }
  const issue = pullRequestIssue({
    ...context,
    allowedBase: pull.base.ref,
    pullRequest: pull
  });
  if (!issue) {
    return null;
  }
  return currentReviewSource(
    { ...context, issueNumber: issue },
    pull,
    callGitHub
  );
}

export function stackReviewRoute(context, callGitHub = githubRequest) {
  const source = readStackReviewSource(context, callGitHub);
  if (!source) {
    return null;
  }
  const { pull, target } = source;
  if (pull.base.ref === context.defaultBranch && !pull.stack) {
    return null;
  }
  return {
    approval: "none",
    base: pull.base.sha,
    head: pull.head.sha,
    issue: pull.head.ref.slice("claude/issue-".length),
    pull: String(pull.number),
    reason:
      "review the current dependent layer from default-branch CI completion",
    role: pull.base.ref === context.defaultBranch ? "" : "pr-reviewer",
    source: context.sourceRunId,
    stack_pull: pull.stack ? String(pull.number) : "",
    writer: target.writer
  };
}

function currentReviewSource(context, pull, callGitHub) {
  const target = deliveryTarget(context, callGitHub);
  if (pull.base.ref !== target.base) {
    throw new Error("Stack PR targets an unapproved dependency branch");
  }
  const latest = readRepairCi(context, pull, callGitHub);
  return String(latest?.id) === context.sourceRunId ? { pull, target } : null;
}

function isCurrentCiSource(context, run) {
  return (
    run.path === context.ciWorkflow &&
    run.event === "pull_request" &&
    run.head_repository?.full_name === context.repository &&
    run.status === "completed" &&
    ["failure", "success"].includes(run.conclusion) &&
    run.pull_requests?.length === 1
  );
}

function mergedStackPull(context, run, callGitHub) {
  if (run.event !== "push") {
    return "";
  }
  const pulls = readPages(
    `repos/${context.repository}/commits/${run.head_sha}/pulls`,
    callGitHub
  );
  const merged = pulls.find(
    (pull) =>
      pull.stack && pull.merged_at && pull.stack.base.ref === run.head_branch
  );
  return merged ? String(merged.number) : "";
}

function parentRunIssue(context, run) {
  if (
    run.path !== context.ciWorkflow ||
    run.head_repository?.full_name !== context.repository ||
    run.status !== "completed" ||
    !["pull_request", "push"].includes(run.event)
  ) {
    return null;
  }
  return String(run.head_branch).match(/^claude\/issue-([1-9]\d*)$/)?.[1];
}

function readRun(context, callGitHub) {
  if (!/^[1-9]\d*$/.test(context.sourceRunId)) {
    throw new Error("Invalid CI source");
  }
  return callGitHub({
    path: `repos/${context.repository}/actions/runs/${context.sourceRunId}`
  });
}
