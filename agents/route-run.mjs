import { appendFileSync } from "node:fs";

import { resolveCorrection } from "./automation.mjs";
import { parentProgressRoute } from "./delivery-progress.mjs";
import { resolveChildDiscovery } from "./delivery.mjs";
import { resolveCiWorkflow } from "./repair-evidence.mjs";
import { resolveRepair } from "./repair.mjs";
import { decide, resolveEnabledRoles, settingsFor } from "./route.mjs";
import { parentIntegrationRoute, stackReviewRoute } from "./stack-review.mjs";

function correctionDecision(environment) {
  if (!resolveEnabledRoles(environment.AI_ROLES).has("planner")) {
    return { approval: "none", reason: "planner is not in AI_ROLES", role: "" };
  }
  const resolve =
    environment.HANDOFF_PHASE === "child-planner"
      ? resolveChildDiscovery
      : resolveCorrection;
  return resolve({
    appLogin: environment.APP_LOGIN,
    issueNumber: environment.HANDOFF_ISSUE,
    phase: environment.HANDOFF_PHASE,
    repository: environment.GITHUB_REPOSITORY,
    reviewerLogin: environment.REVIEWER_LOGIN,
    senderLogin: environment.EVENT_SENDER,
    sourceRunId: environment.HANDOFF_SOURCE
  });
}

function implementationDecision(context, stack) {
  if (context.eventName === "workflow_run") {
    const merged = parentIntegrationRoute(context);
    if (merged) {
      return merged;
    }
  }
  const repair = resolveRepair(context);
  return stack?.stack_pull
    ? { ...stack, ...repair, issue: repair.issue ?? stack.issue }
    : repair;
}
function main() {
  const environment = process.env;
  const decision = routeEvent(environment);
  const settings = settingsFor(decision.role, environment);

  // eslint-disable-next-line security/detect-non-literal-fs-filename -- GITHUB_OUTPUT is the runner's own path, and nothing else can set it.
  appendFileSync(
    environment.GITHUB_OUTPUT,
    Object.entries({ ...decision, ...settings })
      .map(([key, value]) => `${key}=${value}\n`)
      .join("")
  );
}

function repairContext(environment) {
  return {
    appLogin: environment.APP_LOGIN,
    ciWorkflow: resolveCiWorkflow(environment.AI_CI_WORKFLOW),
    defaultBranch: environment.EVENT_DEFAULT_BRANCH,
    eventName: environment.EVENT_NAME,
    pullRequestNumber: environment.HANDOFF_PULL,
    repository: environment.GITHUB_REPOSITORY,
    reviewerLogin: environment.REVIEWER_LOGIN,
    senderLogin: environment.EVENT_SENDER,
    sourceKind: environment.EVENT_NAME === "workflow_run" ? "ci" : "review",
    sourceRunId:
      environment.EVENT_NAME === "workflow_run"
        ? environment.CI_RUN
        : environment.HANDOFF_SOURCE
  };
}

function repairDecision(environment) {
  const roles = resolveEnabledRoles(environment.AI_ROLES);
  const context = repairContext(environment);
  const stack = currentStackReview(context, roles);
  if (stack?.role && roles.has("pr-reviewer")) {
    return {
      ...stack,
      stack_pull: roles.has("implementer") ? stack.stack_pull : ""
    };
  }
  if (!roles.has("implementer")) {
    return {
      approval: "none",
      reason: "implementer is not in AI_ROLES",
      role: ""
    };
  }
  return implementationDecision(context, stack);
}

function routeEvent(environment) {
  if (
    environment.EVENT_NAME === "pull_request_target" &&
    environment.EVENT_ACTION === "closed" &&
    resolveEnabledRoles(environment.AI_ROLES).has("implementer")
  ) {
    const pull = JSON.parse(environment.EVENT_PULL_REQUEST);
    return parentProgressRoute({
      appLogin: environment.APP_LOGIN,
      defaultBranch: environment.EVENT_DEFAULT_BRANCH,
      pullRequestNumber: String(pull.number),
      repository: environment.GITHUB_REPOSITORY
    });
  }
  if (
    environment.EVENT_NAME === "workflow_run" ||
    (environment.EVENT_NAME === "repository_dispatch" &&
      environment.HANDOFF_PHASE === "implementer")
  ) {
    return repairDecision(environment);
  }
  return environment.EVENT_NAME === "repository_dispatch"
    ? correctionDecision(environment)
    : decide(environment);
}

main();

function currentStackReview(context, roles) {
  if (
    context.eventName !== "workflow_run" ||
    (!roles.has("pr-reviewer") && !roles.has("implementer"))
  ) {
    return null;
  }
  return stackReviewRoute(context);
}
