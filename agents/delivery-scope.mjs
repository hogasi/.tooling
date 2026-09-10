import { readDeliveryPlan } from "./delivery-plan.mjs";
import { githubRequest, readPages } from "./github.mjs";
import { readProposal } from "./proposal.mjs";

const MARKER = "<!-- hogasi-ai child ";

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

export function verifyInheritance(context, issue, callGitHub = githubRequest) {
  const visited = new Set([issue.number]);
  for (let current = issue; readChild(current, context.appLogin);) {
    const record = readChild(current, context.appLogin);
    if (visited.has(record.parent)) {
      throw new Error("Parent issue cycle");
    }
    visited.add(record.parent);
    current = requireParent(context, { child: current, record }, callGitHub);
  }
}

function requireNativeParent(
  context,
  { child, definition, record },
  callGitHub
) {
  const children = readPages(
    `repos/${context.repository}/issues/${record.parent}/sub_issues`,
    callGitHub
  );
  if (children.every((entry) => entry.id !== child.id)) {
    throw new Error("Child no longer belongs to its recorded parent");
  }
  const expected = siblingPrerequisites(context, {
    children,
    definition,
    record
  });
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

function requireParent(context, { child, record }, callGitHub) {
  const parentContext = { ...context, issueNumber: String(record.parent) };
  const parent = callGitHub({
    path: `repos/${context.repository}/issues/${record.parent}`
  });
  if (
    parent.state !== "open" ||
    parent.labels.every((label) => label.name !== "ready for dev")
  ) {
    throw new Error("Parent delivery is closed or authorization was removed");
  }
  const proposal = readProposal(parentContext, callGitHub);
  if (proposal.id !== record.proposal || proposal.digest !== record.digest) {
    throw new Error("Inherited parent decisions changed; replan the child");
  }
  const definition = readDeliveryPlan(proposal).find(
    (entry) => entry.key === record.key
  );
  if (
    !definition ||
    child.body !== childBody(parentContext, { child: definition, proposal })
  ) {
    throw new Error("Child request no longer matches its parent deliverable");
  }
  requireNativeParent(context, { child, definition, record }, callGitHub);
  return parent;
}

function siblingPrerequisites(context, { children, definition, record }) {
  return children
    .filter((entry) => {
      const sibling = readChild(entry, context.appLogin);
      return (
        sibling?.digest === record.digest &&
        definition.dependsOn.includes(sibling.key)
      );
    })
    .map((entry) => entry.id)
    .toSorted((left, right) => left - right);
}

function validateRecord(record) {
  if (
    !Number.isSafeInteger(record.parent) ||
    record.parent < 1 ||
    !Number.isSafeInteger(record.proposal) ||
    !/^[a-f0-9]{64}$/.test(record.digest)
  ) {
    throw new Error("Invalid inherited scope identifiers");
  }
}
