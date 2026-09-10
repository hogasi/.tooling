import { appendFileSync } from "node:fs";

import { resetCorrections } from "./automation.mjs";
import { githubRequest } from "./github.mjs";
import { resolveCiWorkflow } from "./repair-evidence.mjs";
import { claimRepair, resolveRepair } from "./repair.mjs";

const env = process.env;
const context = {
  appLogin: env.APP_LOGIN,
  ciWorkflow: resolveCiWorkflow(env.AI_CI_WORKFLOW),
  defaultBranch: env.DEFAULT_BRANCH,
  eventName: env.GITHUB_EVENT_NAME,
  expectedHead: env.EXPECTED_HEAD,
  pullRequestNumber: env.PULL_REQUEST,
  repository: env.GITHUB_REPOSITORY,
  reviewerLogin: env.REVIEWER_LOGIN,
  runId: env.GITHUB_RUN_ID,
  senderLogin: env.APP_LOGIN,
  sourceKind: env.SOURCE_KIND ?? "review",
  sourceRunId: env.SOURCE_RUN
};
switch (process.argv[2]) {
  case "claim": {
    const claim = claimRepair(context);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Runner-owned output file.
    appendFileSync(env.GITHUB_OUTPUT, `claimed=${Boolean(claim)}\n`);

    break;
  }
  case "dispatch": {
    const decision = resolveRepair(context);
    if (decision.role) {
      githubRequest({
        body: {
          client_payload: {
            phase: "implementer",
            pull: decision.pull,
            source: context.sourceRunId
          },
          event_type: "ai-correction"
        },
        method: "POST",
        path: `repos/${context.repository}/dispatches`
      });
    }

    break;
  }
  case "reset": {
    resetCorrections({
      ...context,
      issueNumber: env.ISSUE,
      phase: "implementer"
    });

    break;
  }
  default: {
    throw new Error("Use repair-run.mjs claim|dispatch|reset");
  }
}
