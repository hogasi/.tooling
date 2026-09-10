import { verifyInheritance } from "./delivery-scope.mjs";
import { githubRequest } from "./github.mjs";
import { planningPulls, verifyPlanningPulls } from "./plan-evidence.mjs";
import { latestComment, readComments, readProposal } from "./proposal.mjs";
import { setStatus } from "./state.mjs";

const MAX_VERDICT_LENGTH = 60_000;
const MARKER = "<!-- hogasi-review plan ";
const issuePath = (context) =>
  `repos/${context.repository}/issues/${context.issueNumber}`;

/**
Capture a ready proposal and revoke the old pass before spending model allowance.
*/
export function beginReview(context, callGitHub = githubRequest) {
  validateContext(context);
  validateRun(context);
  const issue = readReadyIssue(context, callGitHub);
  const inherited = verifyInheritance(context, issue, callGitHub);
  const proposal = readProposal(context, callGitHub);
  if (currentSha(context, callGitHub) !== context.sha) {
    throw new Error("Review input changed while queued; reapply in review");
  }
  const snapshot = {
    digest: proposal.digest,
    proposal: proposal.id,
    pulls: planningPulls(context, { issue, proposal }, callGitHub),
    run: `${context.runId}.${context.attempt}`,
    sha: context.sha
  };
  const comments = readComments(context, callGitHub);
  postRecord(context, callGitHub, {
    message:
      "Plan review started. A failed run leaves this proposal unreviewed.",
    snapshot,
    status: "pending"
  });
  setStatus(context, "in review", callGitHub);
  return { comments, inherited, issue, proposal, snapshot };
}

/**
Publish only if the proposal and repository still match the reviewed snapshot.
*/
export function publishReview(context, callGitHub = githubRequest) {
  validateContext(context);
  const verdict = validateVerdict(context.verdict);
  const issue = readReadyIssue(context, callGitHub);
  const { snapshot } = context;
  const proposal = readProposal(context, callGitHub);
  requireCurrentPlanInput(context, { issue, proposal }, callGitHub);
  if (requirePendingReview(context, callGitHub) !== "pending") {
    return;
  }
  const message = [
    verdict.summary,
    ...verdict.findings.map((finding, index) => `${index + 1}. ${finding}`)
  ].join("\n\n");
  postRecord(context, callGitHub, {
    message,
    snapshot,
    status: verdict.verdict
  });
  setStatus(
    context,
    verdict.verdict === "pass" ? "approved" : "changes requested",
    callGitHub
  );
}

/**
Require the configured reviewer App's current pass, not a label or copied text.
*/
export function requirePlanReview(context, callGitHub = githubRequest) {
  validateContext(context);
  const record = latestRecord(context, callGitHub);
  const proposal = readProposal(context, callGitHub);
  if (
    record?.status !== "pass" ||
    record.digest !== proposal.digest ||
    record.proposal !== proposal.id
  ) {
    throw new Error(
      "No current passing plan review for this proposal revision"
    );
  }
  return record;
}

/**
Reject model output that cannot be published as a coherent verdict.
*/
export function validateVerdict(value) {
  if (
    !value ||
    Object.keys(value).length !== 3 ||
    !isValidText(value.summary) ||
    !hasValidFindings(value.findings)
  ) {
    throw new Error("Malformed review verdict");
  }
  requireConsistentVerdict(value);
  if (JSON.stringify(value).length > MAX_VERDICT_LENGTH) {
    throw new Error("Review verdict exceeds the GitHub comment limit");
  }
  return value;
}

function currentSha(context, callGitHub) {
  const repository = callGitHub({ path: `repos/${context.repository}` });
  if (
    typeof repository?.default_branch !== "string" ||
    !repository.default_branch
  ) {
    throw new Error("Missing default branch");
  }
  const commit = callGitHub({
    path: `repos/${context.repository}/commits/${encodeURIComponent(repository.default_branch)}`
  });
  if (!/^[a-f0-9]{40}$/.test(commit?.sha)) {
    throw new Error("Malformed repository commit");
  }
  return commit.sha;
}

function hasValidFindings(findings) {
  return (
    Array.isArray(findings) && findings.every((finding) => isValidText(finding))
  );
}

function isValidText(text) {
  return typeof text === "string" && text.trim().length > 0;
}

function latestRecord(context, callGitHub) {
  const latest = latestComment({
    comments: readComments(context, callGitHub),
    login: context.reviewerLogin,
    marker: MARKER
  });
  if (!latest) {
    return;
  }
  return {
    ...parseRecord(latest.body.split("\n", 1)[0]),
    updatedAt: latest.updated_at
  };
}

function parseRecord(line) {
  const data = line.slice(MARKER.length, -4);
  let record;
  try {
    record = JSON.parse(data);
  } catch {
    throw new Error("Malformed review record");
  }
  return validateRecord(line, record);
}

function postRecord(context, callGitHub, { message, snapshot, status }) {
  const existing = latestComment({
    comments: readComments(context, callGitHub),
    login: context.reviewerLogin,
    marker: MARKER
  });
  callGitHub({
    body: {
      body: `${MARKER}${JSON.stringify({ ...snapshot, status })} -->\n${message}\n\n[Proposal revision](https://github.com/${context.repository}/issues/${context.issueNumber}#issuecomment-${snapshot.proposal}) · [Review run](https://github.com/${context.repository}/actions/runs/${context.runId}) · Repository commit: \`${snapshot.sha}\``
    },
    method: existing ? "PATCH" : "POST",
    path: existing
      ? `repos/${context.repository}/issues/comments/${existing.id}`
      : `${issuePath(context)}/comments`
  });
}

function readReadyIssue(context, callGitHub) {
  const issue = callGitHub({ path: issuePath(context) });
  if (
    issue?.number !== Number(context.issueNumber) ||
    typeof issue.body !== "string" ||
    issue.pull_request ||
    issue.state !== "open" ||
    !Array.isArray(issue.labels)
  ) {
    throw new Error("Malformed or closed review issue");
  }
  if (issue.labels.every((label) => label.name !== "in review")) {
    throw new Error("Proposal is no longer in review");
  }
  return issue;
}

function requireConsistentVerdict(value) {
  const isPass = value.verdict === "pass" && value.findings.length === 0;
  const hasFindings =
    value.verdict === "changes_requested" && value.findings.length > 0;
  if (!isPass && !hasFindings) {
    throw new Error("Inconsistent review verdict");
  }
}
function requireCurrentPlanInput(context, { issue, proposal }, callGitHub) {
  const { snapshot } = context;
  verifyInheritance(context, issue, callGitHub);
  verifyPlanningPulls(
    context,
    { issue, proposal, pulls: snapshot.pulls },
    callGitHub
  );
  if (
    proposal.digest !== snapshot.digest ||
    currentSha(context, callGitHub) !== snapshot.sha
  ) {
    throw new Error("Review input changed during execution; reapply in review");
  }
}
function requirePendingReview(context, callGitHub) {
  const latest = latestRecord(context, callGitHub);
  const { snapshot } = context;
  if (
    latest?.run !== snapshot.run ||
    latest.digest !== snapshot.digest ||
    latest.sha !== snapshot.sha
  ) {
    throw new Error("Review was superseded");
  }
  return latest.status;
}
function validateContext(context) {
  if (
    !/^[\w-]+\/[\w.-]+$/.test(context.repository) ||
    !/^[1-9]\d*$/.test(context.issueNumber) ||
    !/^[\w-]+\[bot\]$/.test(context.reviewerLogin)
  ) {
    throw new Error("Invalid review context");
  }
}

function validateRecord(line, record) {
  if (
    !line.endsWith(" -->") ||
    !/^[a-f0-9]{64}$/.test(record?.digest) ||
    !/^[a-f0-9]{40}$/.test(record.sha) ||
    !/^[1-9]\d*\.[1-9]\d*$/.test(record.run) ||
    !["changes_requested", "pass", "pending"].includes(record.status)
  ) {
    throw new Error("Malformed review record");
  }
  if (!Number.isSafeInteger(record.proposal)) {
    throw new TypeError("Malformed proposal ID");
  }
  return record;
}

function validateRun(context) {
  if (
    !/^[1-9]\d*$/.test(context.runId) ||
    !/^[1-9]\d*$/.test(context.attempt) ||
    !/^[a-f0-9]{40}$/.test(context.sha)
  ) {
    throw new Error("Invalid review run");
  }
}
