import { githubRequest } from "./github.mjs";
import { readImplementationPull } from "./pull-request.mjs";
import { deliveryTarget } from "./stack-target.mjs";

export function readStack(context, number, callGitHub = githubRequest) {
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new Error("Invalid native stack number");
  }
  const stack = callGitHub({
    path: `repos/${context.repository}/stacks/${number}`
  });
  if (
    !Array.isArray(stack?.pull_requests) ||
    typeof stack.base?.ref !== "string"
  ) {
    throw new TypeError("Malformed native stack");
  }
  return stack;
}

export function registerStack(context, callGitHub = githubRequest) {
  const target = deliveryTarget(context, callGitHub);
  const pull = readImplementationPull(context, callGitHub);
  if (pull.base.ref !== target.base) {
    throw new Error(
      "Implementation PR base differs from its approved dependency"
    );
  }
  if (!target.prerequisite) {
    return pull;
  }
  const lower = target.prerequisite;
  if (pull.stack) {
    requireExistingStack(context, { lower, pull, target }, callGitHub);
    return pull;
  }
  appendStack(
    { ...context, integration: target.integration },
    { lower, pull },
    callGitHub
  );
  return callGitHub({
    path: `repos/${context.repository}/pulls/${pull.number}`
  });
}

function appendStack(context, { lower, pull }, callGitHub) {
  if (lower.stack) {
    const stack = readStack(context, lower.stack.number, callGitHub);
    if (
      stack.base.ref !== context.integration ||
      stack.pull_requests.at(-1)?.number !== lower.number
    ) {
      throw new Error(
        "The prerequisite already has an upper layer; finish that stack first"
      );
    }
    callGitHub({
      body: { pull_requests: [pull.number] },
      method: "POST",
      path: `repos/${context.repository}/stacks/${lower.stack.number}/add`
    });
    return;
  }
  callGitHub({
    body: { pull_requests: [lower.number, pull.number] },
    method: "POST",
    path: `repos/${context.repository}/stacks`
  });
}

function requireExistingStack(context, { lower, pull, target }, callGitHub) {
  const stack = readStack(context, pull.stack.number, callGitHub);
  const index = stack.pull_requests.findIndex(
    (entry) => entry.number === pull.number
  );
  if (
    stack.base.ref !== target.integration ||
    stack.pull_requests[index - 1]?.number !== lower.number
  ) {
    throw new Error(
      "Existing native stack differs from the approved dependency"
    );
  }
}
