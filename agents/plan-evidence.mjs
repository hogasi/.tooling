import { readDeliveryPlan } from "./delivery-plan.mjs";
import { readChild } from "./delivery-scope.mjs";
import { githubRequest, readPages } from "./github.mjs";
import { findImplementationPull } from "./pull-request.mjs";

export function planningPulls(
  context,
  { issue, proposal },
  callGitHub = githubRequest
) {
  const origin = readChild(issue, context.appLogin);
  const definitions = readDeliveryPlan(proposal);
  if (!origin && definitions.length === 0) {
    return [];
  }
  const numbers = relatedIssueNumbers(
    context,
    { definitions, issue, origin },
    callGitHub
  );
  return [...numbers]
    .flatMap((number) => {
      const pull = findImplementationPull(
        { ...context, issueNumber: String(number) },
        callGitHub
      );
      return pull ? [pullIdentity(pull)] : [];
    })
    .toSorted((left, right) => left.number - right.number);
}

export function verifyPlanningPulls(
  context,
  evidence,
  callGitHub = githubRequest
) {
  if (evidence.pulls === undefined) {
    return;
  }
  const current = planningPulls(context, evidence, callGitHub);
  if (JSON.stringify(current) !== JSON.stringify(evidence.pulls)) {
    throw new Error(
      "Referenced PR changed during plan review; reapply in review"
    );
  }
}

function currentChildren(context, { definitions, issue }, callGitHub) {
  return definitions.length === 0
    ? []
    : readPages(
        `repos/${context.repository}/issues/${issue.number}/sub_issues`,
        callGitHub
      ).filter((child) => {
        const record = readChild(child, context.appLogin);
        return (
          record?.parent === issue.number &&
          definitions.some((entry) => entry.key === record.key)
        );
      });
}

function pullIdentity(pull) {
  return {
    base: pull.base.sha,
    baseRef: pull.base.ref,
    head: pull.head.sha,
    number: pull.number,
    state: pull.state
  };
}

function relatedIssueNumbers(
  context,
  { definitions, issue, origin },
  callGitHub
) {
  const children = currentChildren(context, { definitions, issue }, callGitHub);
  const dependencies = origin
    ? readPages(
        `repos/${context.repository}/issues/${issue.number}/dependencies/blocked_by`,
        callGitHub
      )
    : [];
  const numbers = new Set([
    issue.number,
    ...children.map((child) => child.number),
    ...dependencies.map((child) => child.number)
  ]);
  if (origin) {
    numbers.add(origin.parent);
  }
  return numbers;
}
