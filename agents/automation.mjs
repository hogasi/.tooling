import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { githubRequest } from "./github.mjs";
import { latestComment, readComments, readProposal } from "./proposal.mjs";
import { setStatus } from "./state.mjs";

const LIMIT = 3;
const MARKER = "<!-- hogasi-ai correction ";

/**
Call only while holding the same issue writer lock as manual work.
*/
export function claimCorrection(context, evidence, callGitHub = githubRequest) {
  const previous = readCorrection(context, callGitHub);
  const budget = previous ?? { count: 0, keys: [] };
  const key = createHash("sha256")
    .update(JSON.stringify(evidence))
    .digest("hex");
  if (budget.keys.includes(key)) {
    return null;
  }
  if (budget.count >= LIMIT) {
    setStatus(context, "blocked", callGitHub);
    throw new Error(
      "Three automatic corrections exhausted; owner resumption is required"
    );
  }
  const record = {
    count: budget.count + 1,
    keys: [...budget.keys, key],
    phase: context.phase,
    run: context.runId
  };
  writeCorrection(context, { previous, record }, callGitHub);
  return record;
}

export function planCorrection(context, callGitHub = githubRequest) {
  const issue = callGitHub({
    path: `repos/${context.repository}/issues/${context.issueNumber}`
  });
  if (
    issue.state !== "open" ||
    issue.labels.some((label) => label.name === "ready for dev")
  ) {
    return null;
  }
  const proposal = readProposal(context, callGitHub);
  const comment = latestComment({
    comments: readComments(context, callGitHub),
    login: context.reviewerLogin,
    marker: "<!-- hogasi-review plan "
  });
  if (!comment) {
    return null;
  }
  return currentFinding(context, { comment, proposal });
}
/**
Only an explicitly authenticated owner restart or verified completion calls this.
*/
export function resetCorrections(context, callGitHub = githubRequest) {
  const previous = readCorrection(context, callGitHub);
  if (!previous) {
    return;
  }
  writeCorrection(
    context,
    {
      previous,
      record: { count: 0, keys: [], phase: context.phase, run: context.runId }
    },
    callGitHub
  );
}

export function resolveCorrection(context, callGitHub = githubRequest) {
  if (context.senderLogin !== context.appLogin || context.phase !== "planner") {
    throw new Error("Untrusted correction sender or phase");
  }
  requireSource(context, callGitHub);
  const evidence = planCorrection(context, callGitHub);
  return evidence
    ? {
        approval: "none",
        automatic: "true",
        issue: context.issueNumber,
        reason: "authenticated plan findings need correction",
        role: "planner",
        source: context.sourceRunId
      }
    : { approval: "none", reason: "no current plan findings", role: "" };
}

function claimCurrentCorrection(context) {
  requireSource(context, githubRequest);
  const evidence = planCorrection(context);
  const claim = evidence && claimCorrection(context, evidence);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Runner-owned output file.
  appendFileSync(process.env.GITHUB_OUTPUT, `claimed=${Boolean(claim)}\n`);
}

function currentFinding(context, { comment, proposal }) {
  const record = JSON.parse(
    comment.body.split("\n", 1)[0].slice("<!-- hogasi-review plan ".length, -4)
  );
  if (
    record.status !== "changes_requested" ||
    record.digest !== proposal.digest ||
    record.proposal !== proposal.id ||
    record.run.split(".", 1)[0] !== context.sourceRunId
  ) {
    return null;
  }
  return {
    digest: proposal.digest,
    findings: comment.body,
    proposal: proposal.id,
    source: context.sourceRunId
  };
}
function dispatchCorrection(context) {
  const evidence = planCorrection(context);
  if (!evidence) {
    return;
  }
  githubRequest({
    body: {
      client_payload: {
        issue: context.issueNumber,
        phase: context.phase,
        source: context.sourceRunId
      },
      event_type: "ai-correction"
    },
    method: "POST",
    path: `repos/${context.repository}/dispatches`
  });
}
function main() {
  const env = process.env;
  const context = {
    appLogin: env.APP_LOGIN,
    issueNumber: env.ISSUE,
    phase: "planner",
    repository: env.GITHUB_REPOSITORY,
    reviewerLogin: env.REVIEWER_LOGIN,
    runId: env.GITHUB_RUN_ID,
    senderLogin: env.APP_LOGIN,
    sourceRunId: env.SOURCE_RUN
  };
  const commands = new Map([
    ["claim", claimCurrentCorrection],
    ["dispatch", dispatchCorrection],
    ["reset", resetCorrections]
  ]);
  const command = commands.get(process.argv[2]);
  if (!command) {
    throw new Error("Use automation.mjs dispatch|claim|reset");
  }
  command(context);
}

function readCorrection(context, callGitHub) {
  if (!["implementer", "planner"].includes(context.phase)) {
    throw new Error("Invalid correction phase");
  }
  const comments = readComments(context, callGitHub).filter((comment) =>
    comment.body?.startsWith(`${MARKER}${context.phase} `)
  );
  const comment = latestComment({
    comments,
    login: context.appLogin,
    marker: MARKER
  });
  if (!comment) {
    return null;
  }
  const line = comment.body.split("\n", 1)[0];
  const record = JSON.parse(
    line.slice(`${MARKER}${context.phase} `.length, -4)
  );
  validateCounter(line, record);
  return { ...record, comment: comment.id };
}

function requireReviewJob(context, run, callGitHub) {
  const pages = callGitHub({
    paginate: true,
    path: `repos/${context.repository}/actions/runs/${context.sourceRunId}/attempts/${run.run_attempt}/jobs`
  });
  if (
    !Array.isArray(pages) ||
    pages.some((page) => !Array.isArray(page.jobs))
  ) {
    throw new Error("Malformed source jobs");
  }
  const isReviewed = pages
    .flatMap((page) => page.jobs)
    .some(
      (job) =>
        job.name.endsWith("/ Plan review / subscription") &&
        job.conclusion === "success"
    );
  if (!isReviewed) {
    throw new Error("Source plan review has not succeeded");
  }
}
function requireSource(context, callGitHub) {
  if (
    !/^[1-9]\d*$/.test(context.sourceRunId) ||
    !/^[1-9]\d*$/.test(context.issueNumber)
  ) {
    throw new Error("Invalid handoff identifiers");
  }
  const run = callGitHub({
    path: `repos/${context.repository}/actions/runs/${context.sourceRunId}`
  });
  if (run.path !== ".github/workflows/ai.yml" || run.event !== "issues") {
    throw new Error("Untrusted source workflow");
  }
  requireReviewJob(context, run, callGitHub);
}

function validateCounter(line, record) {
  if (
    !line.endsWith(" -->") ||
    !Number.isSafeInteger(record.count) ||
    record.count < 0 ||
    record.count > LIMIT ||
    !Array.isArray(record.keys) ||
    record.keys.length !== record.count
  ) {
    throw new Error("Malformed correction record");
  }
}

function writeCorrection(context, { previous, record }, callGitHub) {
  callGitHub({
    body: {
      body: `${MARKER}${context.phase} ${JSON.stringify(record)} -->\nAutomatic ${context.phase} corrections: ${record.count}/${LIMIT}. [Latest run](https://github.com/${context.repository}/actions/runs/${context.runId}).`
    },
    method: previous ? "PATCH" : "POST",
    path: previous
      ? `repos/${context.repository}/issues/comments/${previous.comment}`
      : `repos/${context.repository}/issues/${context.issueNumber}/comments`
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
