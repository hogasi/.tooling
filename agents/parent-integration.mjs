import { readApprovedProposal } from "./approval.mjs";
import { readIntegratedDelivery } from "./delivery-evidence.mjs";
import { readDeliveryPlan } from "./delivery-plan.mjs";
import { readChild } from "./delivery-scope.mjs";
import { githubRequest, readPages } from "./github.mjs";
import { hasSameRepository } from "./pull-request.mjs";
import { readRepairCi } from "./repair-evidence.mjs";
import { deliveryTarget } from "./stack-target.mjs";

const MARKER = "<!-- hogasi-ai integration ";

export function createParentBranch(context, callGitHub = githubRequest) {
  const { proposal } = readApprovedProposal(context, callGitHub);
  if (readDeliveryPlan(proposal).length === 0) {
    return;
  }
  const branch = `claude/issue-${context.issueNumber}`;
  const refs = callGitHub({
    path: `repos/${context.repository}/git/matching-refs/heads/${branch}`
  });
  if (refs.some((ref) => ref.ref === `refs/heads/${branch}`)) {
    return;
  }
  const target = deliveryTarget(context, callGitHub);
  const base = callGitHub({
    path: `repos/${context.repository}/git/ref/heads/${target.base}`
  });
  callGitHub({
    body: { ref: `refs/heads/${branch}`, sha: base.object.sha },
    method: "POST",
    path: `repos/${context.repository}/git/refs`
  });
}

export function deliveryRows(deliveries) {
  return deliveries.map(
    ({ child, definition, integration }) =>
      `- [${integration ? "x" : " "}] ${child ? `#${child.number}` : definition.key}: ${definition.title}${integration ? ` — integrated by #${integration.pull.number}` : " — pending integration"}`
  );
}

export function draftParentRepair(
  context,
  { callGitHub = githubRequest, pull }
) {
  if (!pull.draft) {
    changeParentReadiness(context, { pull, ready: false }, callGitHub);
  }
}

export function finalizeParentPull(context, callGitHub = githubRequest) {
  const pull = updateParentPull(context, callGitHub);
  if (!pull) {
    return;
  }
  const ready = pull.complete && hasParentCi(context, pull, callGitHub);
  if (pull.draft === !ready) {
    return;
  }
  changeParentReadiness(context, { pull, ready }, callGitHub);
}

export function integrationIssue(context, pull, callGitHub = githubRequest) {
  if (!isParentPull(context, pull)) {
    return null;
  }
  const number = pull.head.ref.match(/^claude\/issue-([1-9]\d*)$/)?.[1];
  if (!number || !String(pull.body).startsWith(MARKER)) {
    return null;
  }
  const state = parentDeliveries(
    { ...context, issueNumber: number },
    callGitHub
  );
  const expected = `${MARKER}${JSON.stringify({ digest: state.approved.digest, proposal: state.approved.proposal.id })} -->`;
  if (pull.body.split("\n", 1)[0] !== expected) {
    throw new Error(
      "The parent integration PR references an outdated proposal"
    );
  }
  return state.complete ? number : null;
}

export function parentDeliveries(context, callGitHub = githubRequest) {
  const approved = readApprovedProposal(context, callGitHub);
  const definitions = readDeliveryPlan(approved.proposal);
  const children = readPages(
    `repos/${context.repository}/issues/${context.issueNumber}/sub_issues`,
    callGitHub
  );
  const deliveries = definitions.map((definition) =>
    parentDelivery(context, { children, definition }, callGitHub)
  );
  return {
    approved,
    complete:
      definitions.length > 0 && deliveries.every((entry) => entry.integration),
    deliveries
  };
}

export function updateParentPull(context, callGitHub = githubRequest) {
  const state = parentDeliveries(context, callGitHub);
  if (state.deliveries.length === 0) {
    return null;
  }
  const branch = `claude/issue-${context.issueNumber}`;
  const base = deliveryTarget(context, callGitHub).base;
  const existing = readParentPull(context, { base, branch }, callGitHub);
  if (!existing && state.deliveries.every((entry) => !entry.integration)) {
    return null;
  }
  const body = parentPullBody(context, state, callGitHub);
  if (existing) {
    if (existing.body !== body) {
      callGitHub({
        body: { body },
        method: "PATCH",
        path: `repos/${context.repository}/pulls/${existing.number}`
      });
    }
    return { ...existing, body, complete: state.complete };
  }
  return createParentPull(context, { base, body, branch, state }, callGitHub);
}

function changeParentReadiness(context, { pull, ready }, callGitHub) {
  const fresh = callGitHub({
    path: `repos/${context.repository}/pulls/${pull.number}`
  });
  if (fresh.head.sha !== pull.head.sha || fresh.base.ref !== pull.base.ref) {
    throw new Error("Parent PR changed while checking integration readiness");
  }
  const mutation = ready
    ? "markPullRequestReadyForReview"
    : "convertPullRequestToDraft";
  const result = callGitHub({
    body: {
      // eslint-disable-next-line unicorn/no-incorrect-template-string-interpolation -- $nodeId is a GraphQL variable, supplied separately.
      query: `mutation($nodeId: ID!) { transition: ${mutation}(input: {pullRequestId: $nodeId}) { pullRequest { isDraft } } }`,
      variables: { nodeId: fresh.node_id }
    },
    method: "POST",
    path: "graphql"
  });
  requireDraftResult(result, !ready);
}

function closingIssues(context, state, callGitHub) {
  const descendants = state.deliveries.flatMap(({ child, integration }) => {
    if (!integration) {
      throw new Error("Cannot finalize an incomplete child delivery");
    }
    if (readDeliveryPlan(integration.approved.proposal).length === 0) {
      return [String(child.number)];
    }
    const nested = { ...context, issueNumber: String(child.number) };
    const delivered = parentDeliveries(nested, callGitHub);
    if (!delivered.complete) {
      throw new Error("Nested parent delivery is incomplete");
    }
    return closingIssues(nested, delivered, callGitHub);
  });
  return [context.issueNumber, ...descendants];
}

function createParentPull(context, { base, body, branch, state }, callGitHub) {
  const pull = callGitHub({
    body: {
      base,
      body,
      draft: true,
      head: branch,
      title: state.approved.issue.title
    },
    method: "POST",
    path: `repos/${context.repository}/pulls`
  });
  return { ...pull, complete: state.complete };
}

function hasParentCi(context, pull, callGitHub) {
  const latest = readRepairCi(context, pull, callGitHub);
  return latest?.status === "completed" && latest.conclusion === "success";
}

function isParentPull(context, pull) {
  return (
    pull.state === "open" &&
    pull.user?.login === context.appLogin &&
    hasSameRepository(pull, context.repository)
  );
}

function parentDelivery(context, { children, definition }, callGitHub) {
  const matches = children.filter((child) => {
    const origin = readChild(child, context.appLogin);
    return (
      origin?.key === definition.key &&
      origin.parent === Number(context.issueNumber)
    );
  });
  if (matches.length > 1) {
    throw new Error("Duplicate native deliverables require reconciliation");
  }
  const child = matches[0];
  return {
    child,
    definition,
    integration: child
      ? readIntegratedDelivery(context, child, callGitHub)
      : null
  };
}

function parentPullBody(context, state, callGitHub) {
  const marker = `${MARKER}${JSON.stringify({ digest: state.approved.digest, proposal: state.approved.proposal.id })} -->`;
  const rows = deliveryRows(state.deliveries);
  const closes = state.complete
    ? closingIssues(context, state, callGitHub)
    : [context.issueNumber];
  return `${marker}\nIntegrates the reviewed deliverables for #${context.issueNumber}.\n\n[Parent proposal](https://github.com/${context.repository}/issues/${context.issueNumber}#issuecomment-${state.approved.proposal.id})\n\n${rows.join("\n")}\n\nCombined CI and independent parent review must pass before owner merge. Child merges integrate work here; only the top-level parent merge delivers it to main.\n\n${closes.map((number) => `Closes #${number}`).join("\n")}`;
}

function readParentPull(context, { base, branch }, callGitHub) {
  const pulls = readPages(
    `repos/${context.repository}/pulls?state=open&head=${context.repository.split("/", 1)[0]}:${branch}&per_page=100`,
    callGitHub
  );
  if (pulls.filter((pull) => pull.head.ref === branch).length > 1) {
    throw new Error("Duplicate parent integration PRs require reconciliation");
  }
  const existing = pulls.find((pull) => pull.head.ref === branch);
  if (
    existing &&
    (!isParentPull(context, existing) || existing.base.ref !== base)
  ) {
    throw new Error("The parent PR is not the expected App integration PR");
  }
  return existing;
}

function requireDraftResult(result, draft) {
  if (
    result.errors ||
    result.data?.transition?.pullRequest?.isDraft !== draft
  ) {
    throw new Error("GitHub did not apply the parent draft transition");
  }
}
