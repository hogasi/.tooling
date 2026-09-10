import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const marker = "<!-- hogasi-ai approval";
const digestOf = (body) => createHash("sha256").update(body).digest("hex");

export function applyApproval(context, callGitHub = githubRequest) {
  validateContext(context);
  requireAuthority(context, callGitHub);
  const issue = readIssue(context, callGitHub);
  if (context.mode === "clear") {
    return clearApproval(context, callGitHub, issue);
  }
  requireLabels(issue);
  return context.mode === "record"
    ? recordApproval(context, callGitHub, issue)
    : verifyApproval(context, callGitHub, issue);
}

function clearApproval(context, callGitHub, issue) {
  const path = `repos/${context.repository}/issues/${context.issueNumber}`;
  if (issue.labels.some((label) => label.name === "approved")) {
    callGitHub({ method: "DELETE", path: `${path}/labels/approved` });
  }
  callGitHub({
    body: {
      body: `${marker} cleared -->\nApproval revoked. Approve the current proposal to implement it.`
    },
    method: "POST",
    path: `${path}/comments`
  });
  return "";
}

function githubRequest({ body, method = "GET", paginate, path }) {
  const args = ["api", path, "--method", method];
  if (paginate) {
    args.push("--paginate", "--slurp");
  }
  if (body) {
    args.push("--input", "-");
  }
  const output = execFileSync("gh", args, {
    encoding: "utf8",
    input: JSON.stringify(body)
  });
  return output.trim() ? JSON.parse(output) : undefined;
}

function latestApproval(context, callGitHub) {
  const pages = callGitHub({
    paginate: true,
    path: `repos/${context.repository}/issues/${context.issueNumber}/comments`
  });
  if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) {
    throw new Error("Malformed comment pages");
  }
  const records = pages
    .flat()
    .filter(
      (comment) =>
        comment.user?.login === context.appLogin &&
        comment.body?.startsWith(marker)
    );
  const latest = records.toSorted((left, right) => right.id - left.id)[0];
  if (!latest) {
    return;
  }
  if (latest.body.startsWith(`${marker} cleared -->`)) {
    return { cleared: true };
  }
  const match = latest.body.match(
    // eslint-disable-next-line security/detect-unsafe-regex -- Fixed delimiters bound the digest and optional numeric run; no ambiguous alternatives.
    /^<!-- hogasi-ai approval sha256=([0-9a-f]{64})(?: run=([1-9]\d*))? -->/
  );
  if (!match) {
    throw new Error("Malformed approval record");
  }
  return { digest: match[1] };
}

function main() {
  const environment = process.env;
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- The Actions runner supplies this event file path.
  const event = JSON.parse(readFileSync(environment.GITHUB_EVENT_PATH, "utf8"));
  const digest = applyApproval({
    actor: environment.ACTOR,
    appLogin: environment.APP_LOGIN,
    event,
    expectedDigest: environment.EXPECTED_DIGEST,
    issueNumber: environment.ISSUE,
    mode: environment.MODE,
    repository: environment.GITHUB_REPOSITORY,
    runId: environment.GITHUB_RUN_ID
  });
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- The Actions runner supplies this output file path.
  appendFileSync(environment.GITHUB_OUTPUT, `digest=${digest}\n`);
}

function readIssue(context, callGitHub) {
  const issue = callGitHub({
    path: `repos/${context.repository}/issues/${context.issueNumber}`
  });
  if (
    issue?.number !== Number(context.issueNumber) ||
    typeof issue.body !== "string" ||
    !Array.isArray(issue.labels)
  ) {
    throw new Error("Malformed issue response");
  }
  return issue;
}

function recordApproval(context, callGitHub, issue) {
  requireApprovalEvent(context, issue);
  if (!/^[1-9]\d*$/.test(context.runId)) {
    throw new Error("Invalid approval run ID");
  }
  const digest = digestOf(context.event.issue.body);
  if (latestApproval(context, callGitHub)?.digest !== digest) {
    callGitHub({
      body: {
        body: `${marker} sha256=${digest} run=${context.runId} -->\nApproval bound to this proposal revision by @${context.actor}. Editing the proposal requires renewed approval.`
      },
      method: "POST",
      path: `repos/${context.repository}/issues/${context.issueNumber}/comments`
    });
  }
  return digest;
}

function requireApprovalEvent(context, issue) {
  const event = context.event;
  if (
    event?.action !== "labeled" ||
    event.label?.name !== "approved" ||
    event.issue?.number !== issue.number
  ) {
    throw new Error("Invalid approval event");
  }
  if (event.issue.body !== issue.body) {
    throw new Error("The proposal changed since the approval event");
  }
}

function requireAuthority(context, callGitHub) {
  const result = callGitHub({
    path: `repos/${context.repository}/collaborators/${context.actor}/permission`
  });
  if (!["admin", "write"].includes(result?.permission)) {
    throw new Error(
      `@${context.actor} needs repository write access to ${context.mode} approval`
    );
  }
}

function requireLabels(issue) {
  const labels = new Set(issue.labels.map((label) => label.name));
  if (!labels.has("approved") || !labels.has("ready")) {
    throw new Error("The proposal must have both ready and approved labels");
  }
}

function validateContext(context) {
  if (!/^[\w-]+\/[\w.-]+$/.test(context.repository)) {
    throw new Error("Invalid repository");
  }
  if (!/^[1-9]\d*$/.test(context.issueNumber)) {
    throw new Error("Invalid issue number");
  }
  if (
    typeof context.actor !== "string" ||
    !/^[\w-]+$/.test(context.actor) ||
    !/^[\w-]+\[bot\]$/.test(context.appLogin)
  ) {
    throw new Error("Invalid actor or App login");
  }
  if (!["clear", "record", "verify"].includes(context.mode)) {
    throw new Error("Invalid approval mode");
  }
}

function verifyApproval(context, callGitHub, issue) {
  const approval = latestApproval(context, callGitHub);
  if (!approval) {
    throw new Error("No approval recorded for this proposal");
  }
  if (approval.cleared) {
    throw new Error("Approval has been revoked");
  }
  const digest = digestOf(issue.body);
  if (approval.digest !== digest) {
    throw new Error("The proposal changed since approval");
  }
  if (
    context.expectedDigest !== undefined &&
    context.expectedDigest !== digest
  ) {
    throw new Error("The queued proposal has been replaced; start a new run");
  }
  return digest;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
