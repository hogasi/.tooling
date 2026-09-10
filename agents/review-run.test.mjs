import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const runner = fileURLToPath(new URL("review-run.mjs", import.meta.url));
const fakeGitHub = `#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
const file = process.env.REVIEW_TEST_STATE;
const state = JSON.parse(readFileSync(file, 'utf8'));
const args = process.argv.slice(2);
const endpoint = args[1];
const method = args[args.indexOf('--method') + 1];
const routes = new Map([
 ['repos/hogasi/sandbox/issues/9', state.issue],
 ['repos/hogasi/sandbox/issues/9/comments', [state.comments]],
 ['repos/hogasi/sandbox/issues/10/comments', [[]]],
 ['repos/hogasi/sandbox/pulls/10', state.pullRequest],
 ['repos/hogasi/sandbox/pulls/10/reviews', [state.reviews]],
 ['repos/hogasi/sandbox', { default_branch: 'main' }],
 ['repos/hogasi/sandbox/commits/main', { sha: state.base }],
 ['repos/hogasi/sandbox/actions/runs?head_sha=' + state.head + '&per_page=100', [{ workflow_runs: [] }]]
]);
if (method === 'GET') {
 if (!routes.has(endpoint)) throw new Error('Unexpected API path: ' + endpoint);
 process.stdout.write(JSON.stringify(routes.get(endpoint)));
} else {
 const body = args.includes('--input') ? JSON.parse(readFileSync(0, 'utf8')) : undefined;
 state.writes.push({ endpoint, method, body });
 if (endpoint.endsWith('/reviews')) state.reviews.push({ ...body, state: 'COMMENTED', user: { login: 'hogasi-review[bot]' } });
 else if (endpoint.endsWith('/comments')) state.comments.push({ ...body, id: state.comments.length + 1, user: { login: 'hogasi-review[bot]' } });
 else if (method === 'DELETE') state.issue.labels = state.issue.labels.filter(label => label.name !== endpoint.split('/').at(-1));
 else if (endpoint.endsWith('/labels')) state.issue.labels.push(...body.labels.map(name => ({ name })));
 writeFileSync(file, JSON.stringify(state));
 process.stdout.write('{}');
}
`;
function fixture(context, mode) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "review-run-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const git = (args) =>
    execFileSync("git", ["-C", directory, ...args], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"]
    }).trim();
  git(["init"]);
  git(["config", "user.name", "Test"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "core.hooksPath", "/dev/null"]);
  writeFileSync(path.join(directory, "app.js"), "export const value = 1;\n");
  git(["add", "app.js"]);
  git(["commit", "-m", "base"]);
  const base = git(["rev-parse", "HEAD"]);
  writeFileSync(path.join(directory, "app.js"), "export const value = 2;\n");
  git(["commit", "-am", "head"]);
  const head = git(["rev-parse", "HEAD"]);
  const issue = {
    body: "Return the new value.",
    labels: ["ready", "reviewed", "ready for dev"].map((name) => ({ name })),
    number: 9,
    state: "open"
  };
  const digest = createHash("sha256").update(issue.body).digest("hex");
  const pullRequest = {
    base: { ref: "main", repo: { full_name: "hogasi/sandbox" }, sha: base },
    draft: false,
    head: {
      ref: "claude/issue-9",
      repo: { full_name: "hogasi/sandbox" },
      sha: head
    },
    number: 10,
    state: "open",
    user: { login: "hogasi-ai[bot]" }
  };
  const stateFile = path.join(directory, "state.json");
  const eventFile = path.join(directory, "event.json");
  const event =
    mode === "plan"
      ? { action: "labeled", issue, label: { name: "ready" } }
      : { action: "opened", pull_request: pullRequest };
  writeFileSync(eventFile, JSON.stringify(event));
  writeFileSync(
    stateFile,
    JSON.stringify({
      base,
      comments: [
        {
          body: `<!-- hogasi-ai approval sha256=${digest} run=100 -->`,
          id: 1,
          user: { login: "hogasi-ai[bot]" }
        }
      ],
      head,
      issue,
      pullRequest,
      reviews: [],
      writes: []
    })
  );
  writeFileSync(path.join(directory, "gh"), fakeGitHub, { mode: 0o700 });
  const env = {
    ...process.env,
    BUILDER_LOGIN: "hogasi-ai[bot]",
    DEFAULT_BRANCH: "main",
    EFFORT: "medium",
    GITHUB_EVENT_NAME: mode === "plan" ? "issues" : "pull_request_target",
    GITHUB_EVENT_PATH: eventFile,
    GITHUB_OUTPUT: path.join(directory, "output"),
    GITHUB_REPOSITORY: "hogasi/sandbox",
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_RUN_ID: "123",
    GITHUB_SHA: base,
    GITHUB_STEP_SUMMARY: path.join(directory, "summary"),
    ISSUE: "9",
    MODEL: "gpt-6-astra",
    PATH: `${directory}${path.delimiter}${process.env.PATH}`,
    PULL_REQUEST: "10",
    REVIEW_MODE: mode,
    REVIEW_REPOSITORY: directory,
    REVIEW_TEST_STATE: stateFile,
    REVIEWER_LOGIN: "hogasi-review[bot]",
    RUNNER_TEMP: directory
  };
  const run = (command) =>
    execFileSync(process.execPath, [runner, command], {
      env,
      stdio: ["pipe", "pipe", "pipe"]
    });
  const read = () => JSON.parse(readFileSync(stateFile, "utf8"));
  return { directory, head, read, run };
}
for (const mode of ["plan", "pr"]) {
  test(`the actual ${mode} runner prepares and publishes through GitHub transport`, (context) => {
    const { directory, head, read, run } = fixture(context, mode);
    run("prepare");
    assert.match(
      readFileSync(path.join(directory, "review-prompt.txt"), "utf8"),
      /app.js/
    );
    assert.match(
      readFileSync(path.join(directory, "output"), "utf8"),
      /prepared=true/
    );
    writeFileSync(
      path.join(directory, "review-result.json"),
      JSON.stringify({
        findings: [],
        summary: "Checked the supplied changes.",
        verdict: "pass"
      })
    );
    run("publish");
    if (mode === "plan") {
      assert.match(read().comments.at(-1).body, /"status":"pass"/);
      assert.ok(read().issue.labels.some((label) => label.name === "reviewed"));
    } else {
      assert.equal(read().reviews[0].commit_id, head);
      assert.equal(read().reviews[0].event, "COMMENT");
      run("prepare");
      assert.match(
        readFileSync(path.join(directory, "output"), "utf8"),
        /prepared=false/
      );
      assert.equal(read().reviews.length, 1);
    }
  });
}
