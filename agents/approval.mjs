import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { latestApproval, verifyApproval } from "./authorization-record.mjs";
import { verifyInheritance } from "./delivery-scope.mjs";
import { githubRequest } from "./github.mjs";
import { readProposal } from "./proposal.mjs";
import { requirePlanReview } from "./review.mjs";
import { readDevEvent, setStatus } from "./state.mjs";

const MARKER = "<!-- hogasi-ai authorization ";

export function applyApproval(context, callGitHub = githubRequest) {
  validateContext(context);
  requireAuthority(context, context.actor, callGitHub);
  const issue = readIssue(context, callGitHub);
  if (context.mode === "clear") {
    clearApproval(context, issue, callGitHub);
    return "";
  }
  const inherited = verifyInheritance(context, issue, callGitHub);
  for (const parent of inherited) {
    requireAuthority(context, parent.actor, callGitHub);
  }
  const proposal = readProposal(context, callGitHub);
  requireDevLabel(issue);
  const event = readDevEvent(context, callGitHub);
  if (context.mode === "record") {
    recordApproval(context, { event, issue, proposal }, callGitHub);
  } else {
    const approval = verifyApproval(context, { event, proposal }, callGitHub);
    requireAuthority(context, approval.actor, callGitHub);
  }
  return proposal.digest;
}

/**
PR feedback reads approved scope without granting new implementation authority.
*/
export function readApprovedProposal(context, callGitHub = githubRequest) {
  validateContext(context);
  const issue = readIssue(context, callGitHub);
  requireDevLabel(issue);
  verifyInheritance(context, issue, callGitHub);
  const proposal = readProposal(context, callGitHub);
  const event = readDevEvent(context, callGitHub);
  const authorization = verifyApproval(
    context,
    { event, proposal },
    callGitHub
  );
  return {
    actor: authorization.actor,
    digest: proposal.digest,
    issue,
    proposal
  };
}

function clearApproval(context, issue, callGitHub) {
  if (issue.labels.some((label) => label.name === "ready for dev")) {
    callGitHub({
      method: "DELETE",
      path: `repos/${context.repository}/issues/${context.issueNumber}/labels/ready%20for%20dev`
    });
  }
  postApproval(context, { cleared: true }, callGitHub);
  setStatus(context, "learning", callGitHub);
}

function main() {
  const env = process.env;
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- The Actions runner supplies this event file.
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8"));
  const digest = applyApproval({
    actor: env.ACTOR,
    appLogin: env.APP_LOGIN,
    event,
    expectedDigest: env.EXPECTED_DIGEST,
    issueNumber: env.ISSUE,
    mode: env.MODE,
    repository: env.GITHUB_REPOSITORY,
    reviewerLogin: env.REVIEWER_LOGIN,
    runId: env.GITHUB_RUN_ID
  });
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- The Actions runner supplies this output file.
  appendFileSync(env.GITHUB_OUTPUT, `digest=${digest}\n`);
}

function postApproval(context, record, callGitHub) {
  callGitHub({
    body: {
      body: `${MARKER}${JSON.stringify(record)} -->\n${record.cleared ? "Authorization revoked." : `Proposal revision #${record.proposal} authorized by @${record.actor}.`}`
    },
    method: "POST",
    path: `repos/${context.repository}/issues/${context.issueNumber}/comments`
  });
}
function readIssue(context, callGitHub) {
  const issue = callGitHub({
    path: `repos/${context.repository}/issues/${context.issueNumber}`
  });
  if (
    issue?.number !== Number(context.issueNumber) ||
    issue.state !== "open" ||
    issue.pull_request ||
    !Array.isArray(issue.labels)
  ) {
    throw new Error("Malformed or closed issue");
  }
  return issue;
}
function recordApproval(context, { event, issue, proposal }, callGitHub) {
  const review = requirePlanReview(context, callGitHub);
  requireApprovalEvent(context, { event, issue, proposal, review }, callGitHub);
  const existing = latestApproval(context, callGitHub);
  if (existing?.digest !== proposal.digest || existing.event !== event.id) {
    postApproval(
      context,
      {
        actor: context.actor,
        digest: proposal.digest,
        event: event.id,
        proposal: proposal.id
      },
      callGitHub
    );
  }
  setStatus(context, "in development", callGitHub);
}
function requireApprovalEvent(
  context,
  { event, issue, proposal, review },
  callGitHub
) {
  const source = context.event ?? {};
  if (
    source.action !== "labeled" ||
    source.label?.name !== "ready for dev" ||
    source.issue?.number !== issue.number
  ) {
    throw new Error("Invalid approval event");
  }
  requireReviewedEvent(context, { event, issue, proposal, review }, callGitHub);
}
function requireAuthority(context, actor, callGitHub) {
  if (!/^[\w-]+$/.test(actor)) {
    throw new Error("Invalid owner identity");
  }
  const result = callGitHub({
    path: `repos/${context.repository}/collaborators/${actor}/permission`
  });
  if (!["admin", "write"].includes(result?.permission)) {
    throw new Error("Owner needs repository write access");
  }
}
function requireDevLabel(issue) {
  if (issue.labels.every((label) => label.name !== "ready for dev")) {
    throw new Error("Missing ready for dev label");
  }
}
function requireReviewBeforeApproval(
  context,
  { event, proposal, review },
  callGitHub
) {
  const run = callGitHub({
    path: `repos/${context.repository}/actions/runs/${context.runId}`
  });
  const dates = [
    proposal.createdAt,
    review.updatedAt,
    event.created_at,
    run.created_at
  ].map((value) => Date.parse(value));
  if (
    dates.some((date) => !Number.isFinite(date)) ||
    dates[0] >= dates[2] ||
    dates[1] >= dates[2] ||
    dates[2] > dates[3]
  ) {
    throw new Error(
      "Proposal or review changed after the approval event; remove and reapply ready for dev"
    );
  }
}
function requireReviewedEvent(
  context,
  { event, issue, proposal, review },
  callGitHub
) {
  if (event.actor?.login !== context.actor) {
    throw new Error("Invalid approval actor");
  }
  if (
    issue.labels.every((label) => label.name !== "approved") &&
    latestApproval(context, callGitHub)?.event !== event.id
  ) {
    throw new Error(
      "The proposal needs approved status before owner authorization"
    );
  }
  requireReviewBeforeApproval(context, { event, proposal, review }, callGitHub);
}
function validateContext(context) {
  if (!/^[\w-]+\/[\w.-]+$/.test(context.repository)) {
    throw new Error("Invalid repository");
  }
  if (
    !/^[1-9]\d*$/.test(context.issueNumber) ||
    !/^[\w-]+\[bot\]$/.test(context.appLogin)
  ) {
    throw new Error("Invalid issue or App login");
  }
  if (
    context.mode !== undefined &&
    !["clear", "record", "verify"].includes(context.mode)
  ) {
    throw new Error("Invalid approval mode");
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
