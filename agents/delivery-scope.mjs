import { verifyApproval } from "./authorization-record.mjs";
import { readDeliveryPlan } from "./delivery-plan.mjs";
import { githubRequest, readPages } from "./github.mjs";
import { readCheckpoint, readProposal } from "./proposal.mjs";
import { readDevEvent } from "./state.mjs";

const INHERITED = "<!-- hogasi-ai inherited ";
const MARKER = "<!-- hogasi-ai child ";

export function appendInheritance(body, inherited = []) {
  if (inherited.length === 0) {
    return body;
  }
  const records = inheritanceRecords(inherited);
  return `${body}\n\n${INHERITED}${JSON.stringify(records)} -->`;
}

export function childBody(context, { child, proposal }) {
  const record = {
    digest: proposal.digest,
    key: child.key,
    parent: Number(context.issueNumber),
    proposal: proposal.id
  };
  return `${MARKER}${JSON.stringify(record)} -->\n${child.body}\n\n## Inherited context\n\nParent goal: #${context.issueNumber}. [Reviewed parent proposal](https://github.com/${context.repository}/issues/${context.issueNumber}#issuecomment-${proposal.id}).\n\nThis child owns only the deliverable above. Preserve settled parent decisions; clarify and review this child's plan separately. Its own ready for dev authorization is required before implementation.`;
}

export function readChild(issue, appLogin) {
  if (issue.user?.login !== appLogin || !issue.body?.startsWith(MARKER)) {
    return null;
  }
  const line = issue.body.split("\n", 1)[0];
  if (!line.endsWith(" -->")) {
    throw new Error("Malformed child record");
  }
  const record = JSON.parse(line.slice(MARKER.length, -4));
  validateRecord(record);
  return record;
}

export function readInheritance(context, issue, callGitHub = githubRequest) {
  const visited = new Set([issue.number]);
  const inherited = [];
  for (let current = issue; readChild(current, context.appLogin);) {
    const origin = readChild(current, context.appLogin);
    if (visited.has(origin.parent)) {
      throw new Error("Parent issue cycle");
    }
    visited.add(origin.parent);
    verifyOrigin(context, { issue: current, origin }, callGitHub);
    const parent = readParent(context, { child: current, origin }, callGitHub);
    inherited.push(parent);
    current = parent.issue;
  }
  for (const [index, entry] of inherited.entries()) {
    requireInheritedRecord(entry.proposal, inherited.slice(index + 1));
  }
  return inherited;
}

export function verifyInheritance(context, issue, callGitHub = githubRequest) {
  const inherited = readInheritance(context, issue, callGitHub);
  if (inherited.length > 0) {
    requireInheritedRecord(readProposal(context, callGitHub), inherited);
  }
  return inherited;
}

function inheritanceRecords(inherited) {
  return inherited.map(({ definition, issue, proposal }) => ({
    digest: proposal.digest,
    key: definition.key,
    parent: issue.number,
    proposal: proposal.id
  }));
}

function readParent(context, { child, origin }, callGitHub) {
  const scope = {
    ...context,
    expectedDigest: undefined,
    issueNumber: String(origin.parent)
  };
  const issue = callGitHub({
    path: `repos/${context.repository}/issues/${origin.parent}`
  });
  if (
    issue.state !== "open" ||
    issue.labels.every((label) => label.name !== "ready for dev")
  ) {
    throw new Error("Parent delivery is closed or authorization was removed");
  }
  const proposal = readProposal(scope, callGitHub);
  const event = readDevEvent(scope, callGitHub);
  const authorization = verifyApproval(scope, { event, proposal }, callGitHub);
  const definition = readDeliveryPlan(proposal).find(
    (entry) => entry.key === origin.key
  );
  if (!definition) {
    throw new Error(
      "The parent replaced this deliverable; reconcile its child issue"
    );
  }
  requireNativeParent(context, { child, definition, origin }, callGitHub);
  return { actor: authorization.actor, definition, issue, proposal };
}

function requireDependencies(
  context,
  { child, definition, expected },
  callGitHub
) {
  const actual = readPages(
    `repos/${context.repository}/issues/${child.number}/dependencies/blocked_by`,
    callGitHub
  )
    .map((entry) => entry.id)
    .toSorted((left, right) => left - right);
  if (
    expected.length !== definition.dependsOn.length ||
    JSON.stringify(actual) !== JSON.stringify(expected)
  ) {
    throw new Error("Child prerequisites changed; reconcile the plan");
  }
}

function requireInheritedRecord(proposal, inherited) {
  if (inherited.length === 0) {
    return;
  }
  const line = proposal.body
    .split("\n")
    .find((entry) => entry.startsWith(INHERITED));
  const expected = `${INHERITED}${JSON.stringify(inheritanceRecords(inherited))} -->`;
  if (line !== expected) {
    throw new Error(
      "Inherited parent decisions changed; replan and authorize the child checkpoint"
    );
  }
}

function requireNativeParent(
  context,
  { child, definition, origin },
  callGitHub
) {
  const children = readPages(
    `repos/${context.repository}/issues/${origin.parent}/sub_issues`,
    callGitHub
  );
  if (children.every((entry) => entry.id !== child.id)) {
    throw new Error("Child no longer belongs to its recorded parent");
  }
  const expected = children
    .filter((entry) => {
      const sibling = readChild(entry, context.appLogin);
      return (
        sibling?.parent === origin.parent &&
        definition.dependsOn.includes(sibling.key)
      );
    })
    .map((entry) => entry.id)
    .toSorted((left, right) => left - right);
  requireDependencies(context, { child, definition, expected }, callGitHub);
}

function validateRecord(record) {
  if (
    !Number.isSafeInteger(record.parent) ||
    record.parent < 1 ||
    !Number.isSafeInteger(record.proposal) ||
    record.proposal < 1 ||
    !/^[a-f0-9]{64}$/.test(record.digest) ||
    !/^[a-z][a-z0-9-]{0,39}$/.test(record.key)
  ) {
    throw new Error("Invalid inherited scope identifiers");
  }
}

function verifyOrigin(context, { issue, origin }, callGitHub) {
  const scope = { ...context, issueNumber: String(origin.parent) };
  const proposal = readCheckpoint(scope, origin.proposal, callGitHub);
  const definition = readDeliveryPlan(proposal).find(
    (entry) => entry.key === origin.key
  );
  if (
    !definition ||
    proposal.digest !== origin.digest ||
    issue.body !== childBody(scope, { child: definition, proposal })
  ) {
    throw new Error(
      "Child request no longer matches its original parent deliverable"
    );
  }
}
