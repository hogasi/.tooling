import { githubRequest, readPages } from "./github.mjs";

const skipReview = (reason) => ({ approval: "none", reason, role: "" });

export function findImplementationPull(context, callGitHub = githubRequest) {
  const branch = `claude/issue-${context.issueNumber}`;
  const pulls = readPages(
    `repos/${context.repository}/pulls?state=open&head=${context.repository.split("/", 1)[0]}:${branch}&per_page=100`,
    callGitHub
  ).filter(
    (pull) =>
      pull.head.ref === branch &&
      pull.state === "open" &&
      hasSameRepository(pull, context.repository) &&
      pull.user?.login === context.appLogin
  );
  if (pulls.length > 1) {
    throw new Error("Expected exactly one open App implementation PR");
  }
  return pulls[0];
}
export function hasSameRepository(pullRequest, repository) {
  return (
    pullRequest.head?.repo?.full_name === repository &&
    pullRequest.base?.repo?.full_name === repository
  );
}
export function mergeTarget(pull) {
  return pull.stack?.base?.ref ?? pull.base?.ref;
}

/**
Return the linked issue only for an open, non-draft implementation PR in this repository.
*/
export function pullRequestIssue({
  allowedBase,
  appLogin,
  defaultBranch,
  pullRequest,
  repository
}) {
  if (!isImplementationPull(pullRequest, appLogin)) {
    return "";
  }
  if (!hasSameRepository(pullRequest, repository)) {
    return "";
  }
  if (pullRequest.base.ref !== (allowedBase ?? defaultBranch)) {
    return "";
  }
  return pullRequest.head.ref?.match(/^claude\/issue-([1-9]\d*)$/)?.[1] ?? "";
}

export function readImplementationPull(context, callGitHub = githubRequest) {
  const pull = findImplementationPull(context, callGitHub);
  if (!pull) {
    throw new Error("Expected exactly one open App implementation PR");
  }
  return pull;
}

export function routePullRequest(event) {
  if (!["opened", "ready_for_review", "synchronize"].includes(event.action)) {
    return skipReview("this PR event starts nothing");
  }
  const isAuthorized =
    event.senderType !== "User" || event.senderLogin.endsWith("[bot]")
      ? event.appLogin !== "" && event.senderLogin === event.appLogin
      : ["admin", "write"].includes(event.senderPermission);
  if (!isAuthorized) {
    return skipReview("the PR event sender lacks write authority");
  }
  const issue = pullRequestIssue(event);
  return issue
    ? {
        approval: "none",
        issue,
        reason: "the implementation PR needs independent review",
        role: "pr-reviewer"
      }
    : skipReview("not an eligible implementation PR");
}

function isImplementationPull(pullRequest, appLogin) {
  return (
    pullRequest?.state === "open" &&
    pullRequest.draft === false &&
    pullRequest.user?.login === appLogin
  );
}
