import { appendFileSync } from "node:fs";

import { refreshDelivery } from "./delivery-progress.mjs";
import { claimChildDiscovery, createChildren } from "./delivery.mjs";
import { githubRequest } from "./github.mjs";
import {
  createParentBranch,
  draftParentRepair,
  finalizeParentPull,
  integrationIssue
} from "./parent-integration.mjs";
import { resolveCiWorkflow } from "./repair-evidence.mjs";
import { deliveryTarget } from "./stack-target.mjs";
import { setStatus } from "./state.mjs";

const env = process.env;
if (
  !/^[\w-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY) ||
  !/^[1-9]\d*$/.test(env.ISSUE)
) {
  throw new Error("Invalid delivery environment");
}
const context = {
  appLogin: env.APP_LOGIN,
  ciWorkflow: resolveCiWorkflow(env.AI_CI_WORKFLOW),
  defaultBranch: env.DEFAULT_BRANCH,
  issueNumber: env.ISSUE,
  repository: env.GITHUB_REPOSITORY,
  reviewerLogin: env.REVIEWER_LOGIN,
  runId: env.GITHUB_RUN_ID,
  senderLogin: env.APP_LOGIN,
  sourceRunId: env.SOURCE_RUN
};
switch (process.argv[2]) {
  case "claim-child": {
    output(`claimed=${claimChildDiscovery(context)}`);

    break;
  }
  case "create": {
    if (env.PULL_REQUEST) {
      const pull = githubRequest({
        path: `repos/${context.repository}/pulls/${env.PULL_REQUEST}`
      });
      if (integrationIssue(context, pull) === context.issueNumber) {
        prepareLeaf();
        draftParentRepair(context, { pull });
        output("parent=true");
        output("leaf=true");
        break;
      }
    }
    createParentBranch(context);
    const children = createChildren(context);
    for (const child of children) {
      if (child.state !== "open") {
        continue;
      }
      githubRequest({
        body: {
          client_payload: {
            issue: String(child.number),
            phase: "child-planner",
            source: context.runId
          },
          event_type: "ai-correction"
        },
        method: "POST",
        path: `repos/${context.repository}/dispatches`
      });
    }
    if (children.length === 0) {
      prepareLeaf();
    }
    output(`leaf=${children.length === 0}`);

    break;
  }
  case "progress": {
    refreshDelivery(context);
    finalizeParentPull(context);

    break;
  }
  default: {
    throw new Error("Use delivery-run.mjs create|claim-child|progress");
  }
}
function output(value) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Runner-owned output file.
  appendFileSync(env.GITHUB_OUTPUT, `${value}\n`);
}

function prepareLeaf() {
  try {
    const target = deliveryTarget(context);
    if (target.writer !== env.EXPECTED_WRITER) {
      throw new Error("The dependency writer changed while queued");
    }
    output(`base=${target.base}`);
  } catch (error) {
    setStatus(context, "blocked");
    throw error;
  }
}
