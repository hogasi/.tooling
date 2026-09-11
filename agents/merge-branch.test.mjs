import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { isolatedGitEnvironment } from "./git-environment.mjs";
import { mergeBranch } from "./merge-branch.mjs";

function fixture(context) {
  const directory = mkdtempSync(path.join(tmpdir(), "merge-branch-test-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const git = (...args) =>
    execFileSync("git", ["-C", directory, ...args], {
      encoding: "utf8",
      env: isolatedGitEnvironment(),
      stdio: ["pipe", "pipe", "pipe"]
    }).trim();
  git("init", "--initial-branch=main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.com");
  git("config", "core.hooksPath", "/dev/null");
  writeFileSync(path.join(directory, "shared.txt"), "original\n");
  git("add", ".");
  git("commit", "-m", "initial");
  git("checkout", "-b", "claude/issue-35");
  writeFileSync(path.join(directory, "child.txt"), "child\n");
  git("add", ".");
  git("commit", "-m", "child");
  const head = git("rev-parse", "HEAD");
  git("checkout", "main");
  writeFileSync(path.join(directory, "base.txt"), "upstream\n");
  git("add", ".");
  git("commit", "-m", "upstream");
  const options = {
    appLogin: "hogasi-ai[bot]",
    base: git("rev-parse", "HEAD"),
    branch: "claude/issue-35",
    head,
    remote: directory
  };
  return { directory, git, options };
}

test("refresh merges the base while preserving both original histories", (context) => {
  const { git, options } = fixture(context);
  mergeBranch(options);
  const result = git("rev-parse", options.branch);
  assert.equal(git("show", `${result}:child.txt`), "child");
  assert.equal(git("show", `${result}:base.txt`), "upstream");
  git("merge-base", "--is-ancestor", options.head, result);
  git("merge-base", "--is-ancestor", options.base, result);
});

test("a concurrent branch edit is preserved and stops refresh", (context) => {
  const { directory, git, options } = fixture(context);
  git("checkout", options.branch);
  writeFileSync(path.join(directory, "later.txt"), "owner edit\n");
  git("add", ".");
  git("commit", "-m", "owner edit");
  const current = git("rev-parse", "HEAD");
  git("checkout", "main");
  assert.throws(() => mergeBranch(options), /changed/);
  assert.equal(git("rev-parse", options.branch), current);
});

test("inherited Git paths cannot redirect a stack merge into the calling repository", (context) => {
  const { directory, git, options } = fixture(context);
  const entry = new URL("merge-branch.mjs", import.meta.url).href;
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { mergeBranch } from ${JSON.stringify(entry)}; mergeBranch(JSON.parse(process.argv[1]));`,
      JSON.stringify(options)
    ],
    {
      env: {
        ...process.env,
        GIT_DIR: path.join(directory, "unexpected.git"),
        GIT_INDEX_FILE: path.join(directory, "unexpected.index"),
        GIT_WORK_TREE: directory
      },
      stdio: ["pipe", "pipe", "pipe"]
    }
  );
  const result = git("rev-parse", options.branch);
  git("merge-base", "--is-ancestor", options.head, result);
  git("merge-base", "--is-ancestor", options.base, result);
  assert.equal(git("config", "--get", "core.bare"), "false");
});

test("a merge conflict leaves the remote branch unchanged", (context) => {
  const { directory, git, options } = fixture(context);
  writeFileSync(path.join(directory, "shared.txt"), "upstream change\n");
  git("commit", "-am", "upstream conflict");
  const base = git("rev-parse", "HEAD");
  git("checkout", options.branch);
  writeFileSync(path.join(directory, "shared.txt"), "child change\n");
  git("commit", "-am", "child conflict");
  const head = git("rev-parse", "HEAD");
  git("checkout", "main");
  assert.throws(() => mergeBranch({ ...options, base, head }), /merge-tree/);
  assert.equal(git("rev-parse", options.branch), head);
});
