/* eslint-disable security/detect-non-literal-fs-filename -- Fixed planning state in the runner's private temporary directory. */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { capturePlanning, publishPlanning } from "./planning.mjs";

const env = process.env;
if (
  !env.RUNNER_TEMP ||
  !/^[\w-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY) ||
  !/^[1-9]\d*$/.test(env.ISSUE)
) {
  throw new Error("Invalid planning environment");
}
const context = {
  appLogin: env.APP_LOGIN,
  issueNumber: env.ISSUE,
  repository: env.GITHUB_REPOSITORY
};
// fallow-ignore-next-line security-sink -- The directory is runner-owned RUNNER_TEMP; the filename is fixed and no model or issue data enters this path.
const state = path.join(env.RUNNER_TEMP, "planning-state.json");
if (process.argv[2] === "capture") {
  writeFileSync(state, JSON.stringify(capturePlanning(context)));
} else if (process.argv[2] === "publish") {
  publishPlanning({
    ...context,
    result: JSON.parse(env.PLANNER_RESULT),
    snapshot: JSON.parse(readFileSync(state, "utf8"))
  });
} else {
  throw new Error("Use planning-run.mjs capture|publish");
}
