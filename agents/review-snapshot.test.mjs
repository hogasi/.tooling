import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { isolatedGitEnvironment } from "./git-environment.mjs";
import {
  pullRequestSnapshot,
  repositorySnapshot,
  requireInputSize
} from "./review-snapshot.mjs";

test("snapshot reads only committed blobs and does not follow symlinks", (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "review-snapshot-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const git = (args) =>
    execFileSync("git", ["-C", directory, ...args], {
      encoding: "utf8",
      env: isolatedGitEnvironment(),
      stdio: ["pipe", "pipe", "ignore"]
    });
  git(["init"]);
  writeFileSync(path.join(directory, "app.js"), "export const value = 1;\n");
  symlinkSync("/not/a/review/file", path.join(directory, "link"));
  git(["add", "."]);
  git([
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "-m",
    "fixture"
  ]);
  const sha = git(["rev-parse", "HEAD"]).trim();
  writeFileSync(path.join(directory, "app.js"), "uncommitted content");
  writeFileSync(path.join(directory, "untracked.txt"), "not in snapshot");
  const files = repositorySnapshot({ directory, sha });
  assert.equal(files.length, 2);
  assert.equal(
    files.find((file) => file.name === "app.js").content,
    "export const value = 1;\n"
  );
  assert.equal(
    files.find((file) => file.name === "link").content,
    "/not/a/review/file"
  );
});
test("oversized review input fails instead of silently truncating evidence", () => {
  assert.throws(() => requireInputSize("x".repeat(512 * 1024 + 1)), /512 KiB/);
});
test("snapshot rejects an unvalidated git revision", () => {
  assert.throws(
    () => repositorySnapshot({ directory: "/tmp", sha: "HEAD" }),
    /SHA/
  );
});

test("PR snapshot uses the three-dot diff and never runs configured diff drivers", (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "pr-snapshot-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const git = (args) =>
    execFileSync("git", ["-C", directory, ...args], {
      encoding: "utf8",
      env: isolatedGitEnvironment(),
      stdio: ["pipe", "pipe", "ignore"]
    });
  git(["init"]);
  git(["config", "user.name", "Test"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "core.hooksPath", "/dev/null"]);
  writeFileSync(path.join(directory, "app.js"), "export const value = 1;\n");
  writeFileSync(path.join(directory, ".gitattributes"), "*.js diff=unsafe\n");
  git(["add", "."]);
  git(["commit", "-m", "base"]);
  const initial = git(["rev-parse", "HEAD"]).trim();
  writeFileSync(path.join(directory, "app.js"), "export const value = 2;\n");
  git(["commit", "-am", "head"]);
  const head = git(["rev-parse", "HEAD"]).trim();
  git(["checkout", "--detach", initial]);
  writeFileSync(path.join(directory, "base-only.txt"), "unrelated base change");
  git(["add", "."]);
  git(["commit", "-m", "base advanced"]);
  const base = git(["rev-parse", "HEAD"]).trim();
  git(["config", "diff.unsafe.command", "false"]);
  git(["config", "diff.unsafe.textconv", "false"]);
  const snapshot = pullRequestSnapshot({ base, directory, head });
  assert.match(snapshot.diff, /-export const value = 1/);
  assert.match(snapshot.diff, /\+export const value = 2/);
  assert.doesNotMatch(snapshot.diff, /base-only/);
  assert.equal(
    snapshot.files.find((file) => file.name === "app.js").content,
    "export const value = 2;\n"
  );
  assert.ok(snapshot.baseFiles.some((file) => file.name === "base-only.txt"));
});
