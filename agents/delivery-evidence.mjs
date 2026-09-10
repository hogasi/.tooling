import { readChild } from "./delivery-scope.mjs";
import { githubRequest, readPages } from "./github.mjs";
import { hasSameRepository } from "./pull-request.mjs";

export function readMergedDelivery(context, child, callGitHub = githubRequest) {
  const branch = `claude/issue-${child.number}`;
  const pulls = readPages(
    `repos/${context.repository}/pulls?state=closed&head=${context.repository.split("/", 1)[0]}:${branch}&per_page=100`,
    callGitHub
  );
  return pulls.find(
    (pull) =>
      pull.merged_at &&
      pull.user?.login === context.appLogin &&
      hasSameRepository(pull, context.repository) &&
      pull.head.ref === branch &&
      pull.base.ref === context.defaultBranch
  );
}

export function requireDependencies(
  context,
  issue,
  callGitHub = githubRequest
) {
  if (!readChild(issue, context.appLogin)) {
    return;
  }
  const dependencies = readPages(
    `repos/${context.repository}/issues/${issue.number}/dependencies/blocked_by`,
    callGitHub
  );
  for (const dependency of dependencies) {
    const current = callGitHub({
      path: `repos/${context.repository}/issues/${dependency.number}`
    });
    // silviu: dependencies must reach main until native stacked delivery is enabled.
    if (
      current.state !== "closed" ||
      !readMergedDelivery(context, current, callGitHub)
    ) {
      throw new Error(
        `Prerequisite #${current.number} is not delivered to the default branch`
      );
    }
  }
}
