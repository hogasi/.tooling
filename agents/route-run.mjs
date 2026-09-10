import { appendFileSync } from "node:fs";

import { resolveCorrection } from "./automation.mjs";
import { decide, resolveEnabledRoles, settingsFor } from "./route.mjs";

function correctionDecision(environment) {
  if (!resolveEnabledRoles(environment.AI_ROLES).has("planner")) {
    return { approval: "none", reason: "planner is not in AI_ROLES", role: "" };
  }
  return resolveCorrection({
    appLogin: environment.APP_LOGIN,
    issueNumber: environment.HANDOFF_ISSUE,
    phase: environment.HANDOFF_PHASE,
    repository: environment.GITHUB_REPOSITORY,
    reviewerLogin: environment.REVIEWER_LOGIN,
    senderLogin: environment.EVENT_SENDER,
    sourceRunId: environment.HANDOFF_SOURCE
  });
}

function main() {
  const environment = process.env;
  const decision =
    environment.EVENT_NAME === "repository_dispatch"
      ? correctionDecision(environment)
      : decide(environment);
  const settings = settingsFor(decision.role, environment);

  // eslint-disable-next-line security/detect-non-literal-fs-filename -- GITHUB_OUTPUT is the runner's own path, and nothing else can set it.
  appendFileSync(
    environment.GITHUB_OUTPUT,
    Object.entries({ ...decision, ...settings })
      .map(([key, value]) => `${key}=${value}\n`)
      .join("")
  );
}

main();
