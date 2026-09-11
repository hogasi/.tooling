import { readApprovedProposal } from "./approval.mjs";
import { claimCorrection, resetCorrections } from "./automation.mjs";
import { githubRequest, readActionsPages } from "./github.mjs";
import { integrationIssue } from "./parent-integration.mjs";
import { readPullEvidence } from "./pr-evidence.mjs";
import { pullRequestIssue } from "./pull-request.mjs";
import { readRepairCi, readRepairVerdict } from "./repair-evidence.mjs";
import { deliveryTarget } from "./stack-target.mjs";

export function claimRepair(context, callGitHub = githubRequest) {
  const evidence = repairEvidence(context, callGitHub);
  if (!evidence || evidence.head !== context.expectedHead) {
    return null;
  }
  if (evidence.operation === "complete") {
    resetCorrections(
      { ...context, issueNumber: evidence.issue, phase: "implementer" },
      callGitHub
    );
    return null;
  }
  // CI and review events for the same input share a claim under the issue writer lock.
  return claimCorrection(
    { ...context, issueNumber: evidence.issue, phase: "implementer" },
    {
      base: evidence.base,
      digest: evidence.digest,
      evidence: evidence.fingerprint,
      head: evidence.head
    },
    callGitHub
  );
}

export function resolveRepair(context, callGitHub = githubRequest) {
  const evidence = repairEvidence(context, callGitHub);
  return evidence
    ? {
        approval: "verify",
        automatic: "true",
        head: evidence.head,
        issue: evidence.issue,
        owner: evidence.owner,
        pull: String(evidence.pull),
        reason:
          evidence.operation === "complete"
            ? "CI and review passed; finish the correction cycle"
            : "current authenticated PR findings need repair",
        role: "implementer",
        source: context.sourceRunId,
        sourceKind: context.sourceKind
      }
    : { approval: "none", reason: "no current repair evidence", role: "" };
}

function approvedEvidence(context, { issue, pull }, callGitHub) {
  if (
    deliveryTarget({ ...context, issueNumber: issue }, callGitHub).base !==
    pull.base.ref
  ) {
    throw new Error("Repair PR targets an unapproved dependency branch");
  }
  const scope = { ...context, issueNumber: issue };
  const approved = readApprovedProposal(scope, callGitHub);
  const verdict = readRepairVerdict(context, { approved, pull }, callGitHub);
  const ci = readRepairCi(context, pull, callGitHub);
  if (context.sourceKind === "ci" && String(ci?.id) !== context.sourceRunId) {
    return null;
  }
  const operation = correctionOperation({ ci, verdict });
  if (!operation) {
    return null;
  }
  return {
    base: pull.base.sha,
    digest: approved.digest,
    fingerprint: readPullEvidence(context, pull, callGitHub).fingerprint,
    head: pull.head.sha,
    issue,
    operation,
    owner: approved.actor,
    pull: pull.number
  };
}

function correctionOperation({ ci, verdict }) {
  const conclusion = ci?.status === "completed" ? ci.conclusion : "";
  if (verdict === "pass" && conclusion === "success") {
    return "complete";
  }
  return verdict === "changes_requested" || conclusion === "failure"
    ? "repair"
    : "";
}

function isCompletedCi(context, run) {
  return (
    run.path === context.ciWorkflow &&
    run.event === "pull_request" &&
    run.head_repository?.full_name === context.repository &&
    run.status === "completed" &&
    ["failure", "success"].includes(run.conclusion)
  );
}

function isSuccessfulReview(job) {
  return (
    job.name.endsWith("/ PR review / subscription") &&
    job.conclusion === "success"
  );
}

function readSourcePull(context, run, callGitHub) {
  const number =
    context.sourceKind === "review"
      ? context.pullRequestNumber
      : run.pull_requests?.length === 1 && String(run.pull_requests[0].number);
  if (!/^[1-9]\d*$/.test(number)) {
    return null;
  }
  const pull = callGitHub({
    path: `repos/${context.repository}/pulls/${number}`
  });
  if (context.sourceKind === "ci" && pull.head.sha !== run.head_sha) {
    return null;
  }
  return pull;
}

function repairEvidence(context, callGitHub) {
  requireContext(context);
  const run = callGitHub({
    path: `repos/${context.repository}/actions/runs/${context.sourceRunId}`
  });
  if (context.sourceKind === "review") {
    requireReviewSource(context, run, callGitHub);
  } else if (!isCompletedCi(context, run)) {
    return null;
  }
  const pull = readSourcePull(context, run, callGitHub);
  if (!pull) {
    return null;
  }
  const issue = pull.draft
    ? integrationIssue(context, pull, callGitHub)
    : pullRequestIssue({
        ...context,
        allowedBase: pull.base.ref,
        pullRequest: pull
      });
  if (!issue) {
    return null;
  }
  return approvedEvidence(context, { issue, pull }, callGitHub);
}

function requireContext(context) {
  if (
    !/^[\w-]+\/[\w.-]+$/.test(context.repository) ||
    !/^[1-9]\d*$/.test(context.sourceRunId)
  ) {
    throw new Error("Invalid repair identifiers");
  }
  if (
    context.sourceKind === "review" &&
    context.senderLogin === context.appLogin &&
    /^[1-9]\d*$/.test(context.pullRequestNumber)
  ) {
    return;
  }
  if (context.sourceKind === "ci" && context.eventName === "workflow_run") {
    return;
  }
  throw new Error("Untrusted repair event");
}

function requireReviewSource(context, run, callGitHub) {
  if (
    run.path !== ".github/workflows/ai.yml" ||
    !["pull_request_target", "workflow_run"].includes(run.event)
  ) {
    throw new Error("Untrusted PR review source");
  }
  const jobs = readActionsPages(
    {
      collection: "jobs",
      path: `repos/${context.repository}/actions/runs/${context.sourceRunId}/attempts/${run.run_attempt}/jobs`
    },
    callGitHub
  );
  const isSucceeded = jobs.some((job) => isSuccessfulReview(job));
  if (!isSucceeded) {
    throw new Error("Source PR review has not succeeded");
  }
}
