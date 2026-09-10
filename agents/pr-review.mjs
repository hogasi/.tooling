import { createHash } from "node:crypto";

import { readApprovedProposal } from "./approval.mjs";
import { githubRequest, readPages } from "./github.mjs";
import { pullRequestIssue } from "./pull-request.mjs";
import { validateVerdict } from "./review.mjs";

const MAX_REVIEW_BODY = 65_536;
const pullPath = (context) =>
  `repos/${context.repository}/pulls/${context.pullRequestNumber}`;
const marker = (snapshot) => `<!-- hogasi-review pr key=${snapshot.key} -->`;

/**
Capture an eligible PR and owner-approved proposal; skip already published input.
*/
export function beginPullRequestReview(context, callGitHub = githubRequest) {
  validateContext(context);
  const pullRequest = readPullRequest(context, callGitHub);
  if (
    pullRequest.head.sha !== context.eventHead ||
    pullRequest.base.sha !== context.eventBase
  ) {
    throw new Error("PR changed while queued; use a current PR event");
  }
  const { digest, proposal } = readApprovedProposal(context, callGitHub);
  const snapshot = reviewSnapshot(context, { digest, pullRequest });
  const reviews = readReviews(context, callGitHub);
  if (hasPublishedReview(context, { reviews, snapshot })) {
    return null;
  }
  const ci = readWorkflowRuns(context, callGitHub, snapshot.head);
  const comments = readPages(
    `repos/${context.repository}/issues/${context.pullRequestNumber}/comments`,
    callGitHub
  );
  return { ci, comments, proposal, pullRequest, reviews, snapshot };
}

/**
Publish one COMMENT review only while base, head and owner approval still match.
*/
export function publishPullRequestReview(context, callGitHub = githubRequest) {
  validateContext(context);
  const verdict = validateVerdict(context.verdict);
  const pullRequest = readPullRequest(context, callGitHub);
  const { digest } = readApprovedProposal(context, callGitHub);
  const current = reviewSnapshot(context, { digest, pullRequest });
  if (current.key !== context.snapshot.key) {
    throw new Error("PR or approved proposal changed during review");
  }
  const reviews = readReviews(context, callGitHub);
  if (hasPublishedReview(context, { reviews, snapshot: current })) {
    return;
  }
  const body = reviewBody(context, verdict);
  callGitHub({
    body: {
      body,
      commit_id: current.head,
      event: "COMMENT"
    },
    method: "POST",
    path: `${pullPath(context)}/reviews`
  });
}

function hasPublishedReview(context, { reviews, snapshot }) {
  const authored = reviews.filter(
    (review) => review.user?.login === context.reviewerLogin
  );
  return authored.some(
    (review) =>
      review.state === "COMMENTED" &&
      review.commit_id === snapshot.head &&
      review.body?.startsWith(marker(snapshot))
  );
}
function readPullRequest(context, callGitHub) {
  const pullRequest = callGitHub({ path: pullPath(context) });
  if (
    pullRequest?.number !== Number(context.pullRequestNumber) ||
    pullRequestIssue({ ...context, pullRequest }) !== context.issueNumber
  ) {
    throw new Error("PR is no longer eligible for review");
  }
  if (
    [pullRequest.head.sha, pullRequest.base.sha].some(
      (sha) => !/^[a-f0-9]{40}$/.test(sha)
    )
  ) {
    throw new Error("Invalid PR commit");
  }
  return pullRequest;
}
function readReviews(context, callGitHub) {
  return readPages(`${pullPath(context)}/reviews`, callGitHub);
}
function readWorkflowRuns(context, callGitHub, head) {
  const pages = callGitHub({
    paginate: true,
    path: `repos/${context.repository}/actions/runs?head_sha=${head}&per_page=100`
  });
  if (
    !Array.isArray(pages) ||
    pages.some((page) => !Array.isArray(page?.workflow_runs))
  ) {
    throw new Error("Malformed workflow runs");
  }
  return pages
    .flatMap((page) => page.workflow_runs)
    .filter((run) => run.head_sha === head)
    .map((run) => ({
      conclusion: run.conclusion,
      id: run.id,
      name: run.name,
      status: run.status
    }));
}
function reviewBody(context, verdict) {
  const ci = context.ci
    .map(
      (run) =>
        `${run.name}: ${run.status} (${run.conclusion ?? "no conclusion"})`
    )
    .join("; ");
  const findings = verdict.findings
    .map((finding, index) => `${index + 1}. ${finding}`)
    .join("\n\n");
  const { snapshot } = context;
  const body = `${marker(snapshot)}\n${verdict.summary}\n\n${findings}\n\nReviewed head \`${snapshot.head}\` against base \`${snapshot.base}\` and proposal #${context.issueNumber} (\`${snapshot.digest}\`).\n\nCI at capture: ${ci.length > 0 ? ci : "No Actions runs reported for this head."}\n\nFeedback only; CI and owner merge approval remain separate.\n[Review run](https://github.com/${context.repository}/actions/runs/${context.runId}) · ${snapshot.model}, ${snapshot.effort}`;
  if (body.length > MAX_REVIEW_BODY) {
    throw new Error("PR review exceeds GitHub's body limit");
  }
  return body;
}
function reviewSnapshot(context, { digest, pullRequest }) {
  const input = {
    base: pullRequest.base.sha,
    digest,
    effort: context.effort,
    head: pullRequest.head.sha,
    model: context.model
  };
  const key = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  return { ...input, key };
}
function validateContext(context) {
  if (!/^[\w-]+\/[\w.-]+$/.test(context.repository)) {
    throw new Error("Invalid repository");
  }
  if (
    [context.pullRequestNumber, context.issueNumber, context.runId].some(
      (value) => !/^[1-9]\d*$/.test(value)
    )
  ) {
    throw new Error("Invalid PR, issue or run number");
  }
  if (!/^[\w-]+\[bot\]$/.test(context.reviewerLogin)) {
    throw new Error("Invalid reviewer identity");
  }
}
