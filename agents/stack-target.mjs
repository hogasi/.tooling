import { readApprovedProposal } from "./approval.mjs";
import { readIntegratedDelivery } from "./delivery-evidence.mjs";
import { readDeliveryPlan } from "./delivery-plan.mjs";
import { readChild, verifyInheritance } from "./delivery-scope.mjs";
import { githubRequest, readPages } from "./github.mjs";
import { readImplementationPull } from "./pull-request.mjs";

export function deliveryTarget(context, callGitHub = githubRequest) {
  const { issue, proposal } = readApprovedProposal(context, callGitHub);
  const origin = readChild(issue, context.appLogin);
  const integration = origin
    ? `claude/issue-${origin.parent}`
    : context.defaultBranch;
  const target = {
    base: integration,
    integration,
    prerequisite: null,
    writer: writerIssue(context, callGitHub)
  };
  if (!origin) {
    return target;
  }
  return dependentTarget(context, { issue, proposal, target }, callGitHub);
}

export function writerIssue(context, callGitHub = githubRequest) {
  const issue = callGitHub({
    path: `repos/${context.repository}/issues/${context.issueNumber}`
  });
  const inherited = verifyInheritance(context, issue, callGitHub);
  // silviu: one parent-family writer serializes independent siblings; split locks if throughput warrants it.
  return String(inherited.at(-1)?.issue.number ?? context.issueNumber);
}

function dependentTarget(context, { issue, proposal, target }, callGitHub) {
  const pending = pendingDependencies(context, issue, callGitHub);
  if (pending.length === 0) {
    return target;
  }
  // silviu: native stacks are linear; merge parallel prerequisites before starting a joining child.
  if (pending.length !== 1) {
    throw new Error(
      "Merge parallel prerequisites before starting this child stack"
    );
  }
  if (readDeliveryPlan(proposal).length > 0) {
    throw new Error(
      "Integrate prerequisites before starting this nested parent branch"
    );
  }
  const scope = { ...context, issueNumber: String(pending[0].number) };
  const parent = deliveryTarget(scope, callGitHub);
  const pull = readImplementationPull(scope, callGitHub);
  if (pull.base.ref !== parent.base) {
    throw new Error(
      "Prerequisite PR base no longer matches its approved dependency"
    );
  }
  return {
    ...target,
    base: pull.head.ref,
    prerequisite: pull,
    writer: parent.writer
  };
}

function pendingDependencies(context, issue, callGitHub) {
  const dependencies = readPages(
    `repos/${context.repository}/issues/${issue.number}/dependencies/blocked_by`,
    callGitHub
  );
  return dependencies.filter((dependency) => {
    if (dependency.state === "closed") {
      throw new Error(
        "A prerequisite closed before the parent release; reconcile the child issue"
      );
    }
    return !readIntegratedDelivery(context, dependency, callGitHub);
  });
}
