const skipReview = (reason) => ({ approval: "none", reason, role: "" });

/**
Return the linked issue only for an open, non-draft implementation PR in this repository.
*/
export function pullRequestIssue({
  appLogin,
  defaultBranch,
  pullRequest,
  repository
}) {
  if (!pullRequest || !isImplementationPull(pullRequest, appLogin)) {
    return "";
  }
  if (!hasSameRepository(pullRequest, repository)) {
    return "";
  }
  if (pullRequest.base.ref !== defaultBranch) {
    return "";
  }
  return pullRequest.head.ref?.match(/^claude\/issue-([1-9]\d*)$/)?.[1] ?? "";
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
function hasSameRepository(pullRequest, repository) {
  return (
    pullRequest.head?.repo?.full_name === repository &&
    pullRequest.base?.repo?.full_name === repository
  );
}

function isImplementationPull(pullRequest, appLogin) {
  return (
    pullRequest.state === "open" &&
    pullRequest.draft === false &&
    pullRequest.user?.login === appLogin
  );
}
