import { readActionsPages, readPages } from "./github.mjs";
import { readPullEvidence } from "./pr-evidence.mjs";
import { hasSameRepository } from "./pull-request.mjs";

const RESULT_MARKER = "<!-- hogasi-review result ";

export function readRepairCi(context, pull, callGitHub) {
  const runs = readActionsPages(
    {
      collection: "workflow_runs",
      path: `repos/${context.repository}/actions/runs?head_sha=${pull.head.sha}&per_page=100`
    },
    callGitHub
  )
    .filter(
      (run) =>
        run.path === context.ciWorkflow &&
        run.event === "pull_request" &&
        run.head_sha === pull.head.sha
    )
    .toSorted((left, right) => right.id - left.id);
  const linked = runs.find((run) =>
    run.pull_requests?.some((entry) => entry.number === pull.number)
  );
  const merged = runs.find((run) => isMergedCi(context, { pull, run }));
  if (!merged || linked?.id > merged.id) {
    return linked;
  }
  requireUniqueBranch(context, pull, callGitHub);
  return merged;
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
  const verdict = reviewVerdict(context, { approved, pull, review });
  const record = readResult(review);
  // A merged review is historical evidence; later discussion does not undo its integration.
  if (
    verdict &&
    record.evidence &&
    pull.state === "open" &&
    record.evidence !== readPullEvidence(context, pull, callGitHub).fingerprint
  ) {
    return null;
  }
  return verdict;
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

function isCurrentReviewInput({ approved, pull, record }) {
  return (
    record.base === pull.base.sha &&
    record.baseRef === pull.base.ref &&
    record.head === pull.head.sha &&
    record.digest === approved.digest
  );
}

function isMergedCi(context, { pull, run }) {
  const created = Date.parse(run.created_at);
  return (
    pull.state === "closed" &&
    run.pull_requests?.length === 0 &&
    run.head_branch === pull.head.ref &&
    run.head_repository?.full_name === context.repository &&
    created >= Date.parse(pull.created_at) &&
    created <= Date.parse(pull.merged_at)
  );
}

function readResult(review) {
  const line = review?.body?.split("\n", 2)[1];
  if (!line?.startsWith(RESULT_MARKER) || !line.endsWith(" -->")) {
    return null;
  }
  return JSON.parse(line.slice(RESULT_MARKER.length, -4));
}

function requireUniqueBranch(context, pull, callGitHub) {
  // GitHub clears run.pull_requests after merge. Branch identity is usable only without competing PRs.
  // silviu: archive PR/run bindings before supporting reuse of a delivery branch across PRs.
  const pulls = readPages(
    `repos/${context.repository}/pulls?state=all&head=${context.repository.split("/", 1)[0]}:${pull.head.ref}&per_page=100`,
    callGitHub
  ).filter(
    (entry) =>
      entry.head.ref === pull.head.ref &&
      hasSameRepository(entry, context.repository)
  );
  if (pulls.length !== 1 || pulls[0].number !== pull.number) {
    throw new Error(
      "Ambiguous merged PR CI; the delivery branch must identify exactly one PR"
    );
  }
}

function reviewVerdict(context, { approved, pull, review }) {
  const record = readResult(review);
  if (!record) {
    return null;
  }
  if (!isCurrentReviewInput({ approved, pull, record })) {
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
