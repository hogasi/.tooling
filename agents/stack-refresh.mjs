import { setTimeout } from "node:timers/promises";

import { githubRequest } from "./github.mjs";
import { mergeBranch } from "./merge-branch.mjs";
import { hasSameRepository } from "./pull-request.mjs";
import { deliveryTarget } from "./stack-target.mjs";
import { readStack } from "./stack.mjs";
import { setStatus } from "./state.mjs";

const UPDATE_SECONDS = 30;

export async function refreshStack(
  context,
  { callGitHub = githubRequest, merge = mergeBranch } = {}
) {
  const pull = callGitHub({
    path: `repos/${context.repository}/pulls/${context.pullRequestNumber}`
  });
  if (!pull.stack) {
    return;
  }
  const stack = readStack(context, pull.stack.number, callGitHub);
  const layers = stack.pull_requests.map((entry) =>
    callGitHub({ path: `repos/${context.repository}/pulls/${entry.number}` })
  );
  requireOwnedLayers(context, layers);
  for (const [index, layer] of layers.entries()) {
    if (layer.state !== "open") {
      continue;
    }
    await refreshOwnedLayer(
      { ...context, integration: stack.base.ref },
      { layer, merge, previous: layers[index - 1] },
      callGitHub
    );
  }
}

function containsBase(context, pull, callGitHub) {
  const base = callGitHub({
    path: `repos/${context.repository}/git/ref/heads/${pull.base.ref}`
  });
  const comparison = callGitHub({
    path: `repos/${context.repository}/compare/${base.object.sha}...${pull.head.sha}`
  });
  return ["ahead", "identical"].includes(comparison.status);
}

function refreshBase(context, { layer, previous, target }, callGitHub) {
  const path = `repos/${context.repository}/pulls/${layer.number}`;
  const current = callGitHub({ path });
  if (
    current.head.sha !== layer.head.sha ||
    current.base.ref !== layer.base.ref
  ) {
    throw new Error(
      "Concurrent PR changes interrupted stack refresh; retry from current state"
    );
  }
  if (current.base.ref !== target.base) {
    if (!previous?.merged_at || current.base.ref !== previous.head.ref) {
      throw new Error("Stack base changed outside its approved dependency");
    }
    callGitHub({ body: { base: target.base }, method: "PATCH", path });
  }
  return path;
}

async function refreshLayer(context, { layer, merge, previous }, callGitHub) {
  const target = deliveryTarget(context, callGitHub);
  if (
    target.writer !== context.expectedWriter ||
    target.integration !== context.integration
  ) {
    throw new Error("The stack writer changed while queued");
  }
  const path = refreshBase(context, { layer, previous, target }, callGitHub);
  const fresh = callGitHub({ path });
  if (containsBase(context, fresh, callGitHub)) {
    return;
  }
  const base = callGitHub({
    path: `repos/${context.repository}/git/ref/heads/${fresh.base.ref}`
  });
  merge({
    appLogin: context.appLogin,
    base: base.object.sha,
    branch: fresh.head.ref,
    head: fresh.head.sha,
    remote: `https://github.com/${context.repository}.git`
  });
  await waitForUpdate(context, { head: fresh.head.sha, path }, callGitHub);
}

async function refreshOwnedLayer(
  context,
  { layer, merge, previous },
  callGitHub
) {
  const issue = layer.head.ref.match(/^claude\/issue-([1-9]\d*)$/)?.[1];
  if (!issue) {
    throw new Error("A native stack contains an unknown implementation branch");
  }
  const scope = {
    ...context,

    issueNumber: issue
  };
  try {
    await refreshLayer(scope, { layer, merge, previous }, callGitHub);
  } catch (error) {
    setStatus(scope, "blocked", callGitHub);
    throw error;
  }
}

function requireOwnedLayers(context, layers) {
  if (
    layers.some(
      (layer) =>
        layer.user?.login !== context.appLogin ||
        !hasSameRepository(layer, context.repository)
    )
  ) {
    throw new Error("A native stack contains a foreign implementation");
  }
}

async function waitForUpdate(context, { head, path }, callGitHub) {
  for (let seconds = 0; seconds < UPDATE_SECONDS; seconds += 1) {
    const current = callGitHub({ path });
    if (current.head.sha !== head) {
      if (!containsBase(context, current, callGitHub)) {
        throw new Error("A concurrent edit interrupted the base update");
      }
      return;
    }
    await setTimeout(1000);
  }
  throw new Error(
    "GitHub did not finish the requested branch update within 30 seconds"
  );
}
