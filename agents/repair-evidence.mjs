import { readActionsPages, readPages } from "./github.mjs";

const RESULT_MARKER = "<!-- hogasi-review result ";

export function readRepairCi(context, head, callGitHub) {
  return readActionsPages(
    {
      collection: "workflow_runs",
      path: `repos/${context.repository}/actions/runs?head_sha=${head}&per_page=100`
    },
    callGitHub
  )
    .filter(
      (run) =>
        run.path === context.ciWorkflow &&
        run.event === "pull_request" &&
        run.head_sha === head
    )
    .toSorted((left, right) => right.id - left.id)[0];
}

export function readRepairVerdict(context, { approved, pull }, callGitHub) {
  const reviews = readPages(
    `repos/${context.repository}/pulls/${pull.number}/reviews`,
    callGitHub
  );
  const review = reviews
    .filter(
      (entry) =>
        entry.user?.login === context.reviewerLogin &&
        entry.state === "COMMENTED" &&
        entry.commit_id === pull.head.sha
    )
    .toSorted((left, right) => right.id - left.id)[0];
  return reviewVerdict(context, { approved, pull, review });
}

export function resolveCiWorkflow(raw) {
  const value = raw?.trim();
  if (!value) {
    return ".github/workflows/ci.yml";
  }
  if (!/^\.github\/workflows\/[\w.-]+\.ya?ml$/.test(value)) {
    throw new Error("Invalid enrolled CI workflow path");
  }
  return value;
}

function readResult(review) {
  const line = review?.body?.split("\n", 2)[1];
  if (!line?.startsWith(RESULT_MARKER) || !line.endsWith(" -->")) {
    return null;
  }
  return JSON.parse(line.slice(RESULT_MARKER.length, -4));
}

function reviewVerdict(context, { approved, pull, review }) {
  const record = readResult(review);
  if (!record) {
    return null;
  }
  if (
    record.base !== pull.base.sha ||
    record.head !== pull.head.sha ||
    record.digest !== approved.digest
  ) {
    return null;
  }
  if (context.sourceKind === "review" && record.run !== context.sourceRunId) {
    return null;
  }
  if (!["changes_requested", "pass"].includes(record.status)) {
    throw new Error("Invalid PR review status");
  }
  return record.status;
}
