import { appendDeliveryPlan } from "./delivery-plan.mjs";
import { verifyInheritance } from "./delivery-scope.mjs";
import { githubRequest } from "./github.mjs";
import { latestComment, readComments, readProposal } from "./proposal.mjs";
import { setStatus } from "./state.mjs";

const PROPOSAL = "<!-- hogasi-ai proposal -->\n";
const SUMMARY = "<!-- hogasi-ai planning ";

export function capturePlanning(context, callGitHub = githubRequest) {
  const issue = callGitHub({
    path: `repos/${context.repository}/issues/${context.issueNumber}`
  });
  if (
    issue.number !== Number(context.issueNumber) ||
    issue.state !== "open" ||
    issue.pull_request ||
    issue.labels.some((label) => label.name === "ready for dev")
  ) {
    throw new Error(
      "Planning requires an open issue without development authorization"
    );
  }
  verifyInheritance(context, issue, callGitHub);
  const comments = readComments(context, callGitHub);
  const proposal = latestComment({
    comments,
    login: context.appLogin,
    marker: PROPOSAL
  });
  return { body: issue.body, proposal: proposal?.id ?? null };
}

export function publishPlanning(context, callGitHub = githubRequest) {
  const result = validateResult(context.result);
  const current = capturePlanning(context, callGitHub);
  if (
    current.body !== context.snapshot.body ||
    current.proposal !== context.snapshot.proposal
  ) {
    throw new Error("The request or proposal changed during planning");
  }
  const comments = readComments(context, callGitHub);
  const latest = latestComment({
    comments,
    login: context.appLogin,
    marker: PROPOSAL
  });
  const proposal =
    result.kind === "proposal"
      ? publishCheckpoint(context, { latest, result }, callGitHub)
      : latest;
  publishSummary(context, { comments, proposal, result }, callGitHub);
  if (result.kind === "proposal") {
    readProposal(context, callGitHub);
    setStatus(context, "in review", callGitHub);
  } else {
    setStatus(context, "learning", callGitHub);
  }
}

function publishCheckpoint(context, { latest, result }, callGitHub) {
  const body = `${PROPOSAL}${appendDeliveryPlan(result.proposal, result.deliverables)}`;
  if (latest?.body === body && latest.created_at === latest.updated_at) {
    return latest;
  }
  const created = callGitHub({
    body: { body },
    method: "POST",
    path: `repos/${context.repository}/issues/${context.issueNumber}/comments`
  });
  if (!Number.isSafeInteger(created?.id)) {
    throw new TypeError("GitHub did not return a proposal comment ID");
  }
  return created;
}

function publishSummary(context, { comments, proposal, result }, callGitHub) {
  const summary = latestComment({
    comments,
    login: context.appLogin,
    marker: SUMMARY
  });
  const link = proposal
    ? `\n\n[Proposal revision](https://github.com/${context.repository}/issues/${context.issueNumber}#issuecomment-${proposal.id}).`
    : "";
  callGitHub({
    body: {
      body: `${SUMMARY}${JSON.stringify({ proposal: proposal?.id ?? null })} -->\n${result.summary}${link}`
    },
    method: summary ? "PATCH" : "POST",
    path: summary
      ? `repos/${context.repository}/issues/comments/${summary.id}`
      : `repos/${context.repository}/issues/${context.issueNumber}/comments`
  });
}

function validateBody(value) {
  if (
    typeof value !== "string" ||
    value.length > 60_000 ||
    value.includes("<!-- hogasi-")
  ) {
    throw new TypeError("Invalid planner output body");
  }
}

function validateResult(result) {
  if (!result || !["proposal", "question"].includes(result.kind)) {
    throw new Error("Planner must return a proposal or question");
  }
  for (const value of [result.summary, result.proposal]) {
    validateBody(value);
  }
  if (
    !result.summary.trim() ||
    (result.kind === "proposal") !== Boolean(result.proposal.trim())
  ) {
    throw new Error("Incomplete planner output");
  }
  return result;
}
