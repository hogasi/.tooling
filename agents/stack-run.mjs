import { appendFileSync } from "node:fs";

import { resolveCiWorkflow } from "./repair-evidence.mjs";
import { refreshStack } from "./stack-refresh.mjs";
import { writerIssue } from "./stack-target.mjs";
import { registerStack } from "./stack.mjs";

const env = process.env;
if (
  !/^[\w-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY) ||
  !/^[1-9]\d*$/.test(env.ISSUE)
) {
  throw new Error("Invalid stack environment");
}
const context = {
  appLogin: env.APP_LOGIN,
  ciWorkflow: resolveCiWorkflow(env.AI_CI_WORKFLOW),
  defaultBranch: env.DEFAULT_BRANCH,
  expectedWriter: env.EXPECTED_WRITER,
  issueNumber: env.ISSUE,
  pullRequestNumber: env.PULL_REQUEST,
  repository: env.GITHUB_REPOSITORY,
  reviewerLogin: env.REVIEWER_LOGIN
};

switch (process.argv[2]) {
  case "finish": {
    const pull = registerStack(context);
    await refreshStack({ ...context, pullRequestNumber: String(pull.number) });
    break;
  }
  case "refresh": {
    if (!/^[1-9]\d*$/.test(context.pullRequestNumber)) {
      throw new Error("Invalid stack PR");
    }
    await refreshStack(context);
    break;
  }
  case "writer": {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Runner-owned output file.
    appendFileSync(env.GITHUB_OUTPUT, `writer=${writerIssue(context)}\n`);
    break;
  }
  default: {
    throw new Error("Use stack-run.mjs writer|finish|refresh");
  }
}
