import { readApprovedProposal } from "./approval.mjs";
import { readChild } from "./delivery-scope.mjs";
import { githubRequest, readPages } from "./github.mjs";
import { hasSameRepository, mergeTarget } from "./pull-request.mjs";
import { readRepairCi, readRepairVerdict } from "./repair-evidence.mjs";

export function readIntegratedDelivery(
  context,
  child,
  callGitHub = githubRequest
) {
  const origin = readChild(child, context.appLogin);
  if (
    !origin ||
    child.labels.every((label) => label.name !== "ready for dev")
  ) {
    return null;
  }
  const pull = readMergedDelivery(
    { ...context, deliveryBranch: `claude/issue-${origin.parent}` },
    child,
    callGitHub
  );
  if (!pull) {
    return null;
  }
  const approved = readApprovedProposal(
    { ...context, issueNumber: String(child.number) },
    callGitHub
  );
  return verifiedIntegration(context, { approved, pull }, callGitHub);
}

function readMergedDelivery(context, child, callGitHub = githubRequest) {
  const branch = `claude/issue-${child.number}`;
  const pulls = readPages(
    `repos/${context.repository}/pulls?state=closed&head=${context.repository.split("/", 1)[0]}:${branch}&per_page=100`,
    callGitHub
  );
  return pulls
    .toSorted((left, right) => right.number - left.number)
    .find(
      (pull) =>
        pull.merged_at &&
        pull.user?.login === context.appLogin &&
        hasSameRepository(pull, context.repository) &&
        pull.head.ref === branch &&
        mergeTarget(pull) === context.deliveryBranch
    );
}

function verifiedIntegration(context, evidence, callGitHub) {
  const verdict = readRepairVerdict(
    { ...context, sourceKind: "integration" },
    evidence,
    callGitHub
  );
  const ci = readRepairCi(context, evidence.pull, callGitHub);
  return verdict === "pass" &&
    ci?.status === "completed" &&
    ci.conclusion === "success"
    ? evidence
    : null;
}
