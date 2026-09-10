import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("reaction.sh", import.meta.url));

function runReaction({
  failure = "",
  mode = "finish",
  outcome = "success",
  reaction = "123"
} = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "reaction-test-"));
  const output = path.join(directory, "output");
  const calls = path.join(directory, "calls");
  try {
    writeFileSync(output, "");
    writeFileSync(calls, "");
    writeFileSync(
      path.join(directory, "gh"),
      '#!/bin/bash\nprintf "%s\\n" "$*" >> "$CALLS"\nif [[ -n "$FAILURE" && "$*" == *"$FAILURE"* ]]; then exit 1; fi\nprintf "123\\n"\n',
      { mode: 0o700 }
    );
    const result = spawnSync("bash", [script, mode], {
      encoding: "utf8",
      env: {
        ...process.env,
        CALLS: calls,
        FAILURE: failure,
        GITHUB_OUTPUT: output,
        GITHUB_REPOSITORY: "hogasi/ai-sandbox",
        OUTCOME: outcome,
        PATH: `${directory}:${process.env.PATH}`,
        REACTION: reaction,
        TARGET: "issues/comments/42"
      }
    });
    return {
      ...result,
      calls: readFileSync(calls, "utf8"),
      output: readFileSync(output, "utf8")
    };
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

test("starting records the reaction and triggering comment", () => {
  const result = runReaction({ mode: "start" });
  assert.equal(result.status, 0);
  assert.match(result.calls, /issues\/comments\/42\/reactions.*content=eyes/);
  assert.match(result.output, /id=123/);
  assert.match(result.output, /target=issues\/comments\/42/);
});

test("a failed start reaction warns without blocking the agent", () => {
  const result = runReaction({ failure: "content=eyes", mode: "start" });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /::warning::/);
  assert.doesNotMatch(result.output, /id=/);
  assert.match(result.output, /target=issues\/comments\/42/);
});

for (const outcome of ["success", "failure", "cancelled"]) {
  test(`finishing reports the ${outcome} outcome`, () => {
    const result = runReaction({ outcome });
    assert.equal(result.status, 0);
    assert.match(result.calls, /reactions\/123 --method DELETE/);
    assert.ok(
      result.calls.includes(
        `content=${outcome === "success" ? "rocket" : "confused"}`
      )
    );
  });
}

test("failed cleanup still attempts the final reaction", () => {
  const result = runReaction({ failure: "DELETE" });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /::warning::/);
  assert.match(result.calls, /content=rocket/);
});

test("a failed final reaction warns without changing the job result", () => {
  const result = runReaction({ failure: "content=rocket" });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /::warning::/);
});

test("the final reaction is attempted even when no start reaction was created", () => {
  const result = runReaction({ reaction: "" });
  assert.equal(result.status, 0);
  assert.doesNotMatch(result.calls, /DELETE/);
  assert.match(result.calls, /content=rocket/);
});
