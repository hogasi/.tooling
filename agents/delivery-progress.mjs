import { readChild } from "./delivery-scope.mjs";
import { githubRequest } from "./github.mjs";
import { deliveryRows, parentDeliveries } from "./parent-integration.mjs";
import { latestComment, readComments } from "./proposal.mjs";
import { hasSameRepository, mergeTarget } from "./pull-request.mjs";

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
  return child && mergeTarget(pull) === `claude/issue-${child.parent}`
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
  const { approved, deliveries } = parentDeliveries(context, callGitHub);
  const rows = deliveryRows(deliveries);
  const summary = latestComment({
    comments: readComments(context, callGitHub),
    login: context.appLogin,
    marker: MARKER
  });
  const body = `${MARKER}${JSON.stringify({ proposal: approved.proposal.id })} -->\n${rows.join("\n")}\n\nEach child needs its own reviewed proposal and owner ready for dev. Checked items have a reviewed App PR integrated into the parent branch. Child issues remain open until the top-level parent PR delivers the combined feature to main.`;
  callGitHub({
    body: { body },
    method: summary ? "PATCH" : "POST",
    path: summary
      ? `repos/${context.repository}/issues/comments/${summary.id}`
      : `repos/${context.repository}/issues/${context.issueNumber}/comments`
  });
}

function mergedChildIssue(context, pull) {
  if (
    !pull.merged_at ||
    pull.user?.login !== context.appLogin ||
    !hasSameRepository(pull, context.repository)
  ) {
    return "";
  }
  return pull.head.ref.match(/^claude\/issue-([1-9]\d*)$/)?.[1] ?? "";
}
