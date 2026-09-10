import { readApprovedProposal } from "./approval.mjs";
import { readMergedDelivery } from "./delivery-evidence.mjs";
import { readChild } from "./delivery-scope.mjs";
import { githubRequest, readPages } from "./github.mjs";
import { latestComment, readComments } from "./proposal.mjs";
import { hasSameRepository } from "./pull-request.mjs";

const MARKER = "<!-- hogasi-ai delivery ";

export function parentProgressRoute(context, callGitHub = githubRequest) {
  const pull = callGitHub({
    path: `repos/${context.repository}/pulls/${context.pullRequestNumber}`
  });
  const issueNumber = mergedChildIssue(context, pull);
  if (!issueNumber) {
    return {
      approval: "none",
      reason: "not a merged child implementation",
      role: ""
    };
  }
  const issue = callGitHub({
    path: `repos/${context.repository}/issues/${issueNumber}`
  });
  const child = readChild(issue, context.appLogin);
  return child
    ? {
        approval: "none",
        issue: String(child.parent),
        reason: "refresh parent delivery evidence after child merge",
        role: "delivery-tracker"
      }
    : {
        approval: "none",
        reason: "standalone issue has no parent delivery",
        role: ""
      };
}

export function refreshDelivery(context, callGitHub = githubRequest) {
  const { proposal } = readApprovedProposal(context, callGitHub);
  const linked = readPages(
    `repos/${context.repository}/issues/${context.issueNumber}/sub_issues`,
    callGitHub
  );
  const children = linked.filter(
    (issue) => readChild(issue, context.appLogin)?.digest === proposal.digest
  );
  const rows = children.map((child) => deliveryRow(context, child, callGitHub));
  const summary = latestComment({
    comments: readComments(context, callGitHub),
    login: context.appLogin,
    marker: MARKER
  });
  const body = `${MARKER}${JSON.stringify({ proposal: proposal.id })} -->\n${rows.join("\n")}\n\nEach child needs its own reviewed proposal and owner ready for dev. Checked items have an App PR merged into the default branch; issue closure alone is not delivery evidence. Verify the overall parent acceptance criteria before closing this parent.`;
  callGitHub({
    body: { body },
    method: summary ? "PATCH" : "POST",
    path: summary
      ? `repos/${context.repository}/issues/comments/${summary.id}`
      : `repos/${context.repository}/issues/${context.issueNumber}/comments`
  });
}

function deliveryRow(context, child, callGitHub) {
  if (child.state !== "closed") {
    return `- [ ] #${child.number}: ${child.title}`;
  }
  const delivered = readMergedDelivery(context, child, callGitHub);
  return delivered
    ? `- [x] #${child.number}: ${child.title} — merged in #${delivered.number}`
    : `- [ ] #${child.number}: ${child.title} — closed without a verified PR merge`;
}

function mergedChildIssue(context, pull) {
  if (
    !pull.merged_at ||
    pull.user?.login !== context.appLogin ||
    !hasSameRepository(pull, context.repository) ||
    pull.base.ref !== context.defaultBranch
  ) {
    return "";
  }
  return pull.head.ref.match(/^claude\/issue-([1-9]\d*)$/)?.[1] ?? "";
}
