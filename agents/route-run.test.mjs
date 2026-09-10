import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
const runner = fileURLToPath(new URL("route-run.mjs", import.meta.url));
test("the routing CLI preserves human discovery and rejects a forged automatic sender", (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "route-cli-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const env = {
    ...process.env,
    AI_DEFAULT_EFFORT: "high",
    AI_DEFAULT_PLANNER_MODEL: "fable",
    AI_ROLES: "planner",
    APP_LOGIN: "builder[bot]",
    EVENT_ACTION: "opened",
    EVENT_ASSOCIATION_SUBJECT: "owner",
    EVENT_AUTHOR_ASSOCIATION: "OWNER",
    EVENT_NAME: "issues",
    EVENT_SENDER: "owner",
    EVENT_SENDER_TYPE: "User",
    GITHUB_OUTPUT: path.join(directory, "output")
  };
  execFileSync(process.execPath, [runner], { env });
  assert.match(readFileSync(env.GITHUB_OUTPUT, "utf8"), /role=planner/);
  assert.throws(
    () =>
      execFileSync(process.execPath, [runner], {
        env: {
          ...env,
          EVENT_NAME: "repository_dispatch",
          HANDOFF_PHASE: "planner"
        },
        stdio: "pipe"
      }),
    /Untrusted correction sender/
  );
});

test("workflow completion is inert while implementation is disabled", (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "route-disabled-ci-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const output = path.join(directory, "output");
  execFileSync(process.execPath, [runner], {
    env: {
      ...process.env,
      AI_ROLES: "planner",
      EVENT_NAME: "workflow_run",
      GITHUB_OUTPUT: output
    }
  });
  assert.match(readFileSync(output, "utf8"), /implementer is not in AI_ROLES/);
  assert.doesNotMatch(readFileSync(output, "utf8"), /role=implementer/);
});
