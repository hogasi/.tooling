import { appendFileSync } from "node:fs";

import { refreshDelivery } from "./delivery-progress.mjs";
import { claimChildDiscovery, createChildren } from "./delivery.mjs";
import { githubRequest } from "./github.mjs";

const env = process.env;
if (
  !/^[\w-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY) ||
  !/^[1-9]\d*$/.test(env.ISSUE)
) {
  throw new Error("Invalid delivery environment");
}
const context = {
  appLogin: env.APP_LOGIN,
  defaultBranch: env.DEFAULT_BRANCH,
  issueNumber: env.ISSUE,
  repository: env.GITHUB_REPOSITORY,
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
    output(`leaf=${children.length === 0}`);

    break;
  }
  case "progress": {
    refreshDelivery(context);

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
