import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { repositorySnapshot, requireInputSize } from "./review-snapshot.mjs";

test("snapshot reads only committed blobs and does not follow symlinks", (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "review-snapshot-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const git = (args) =>
    execFileSync("git", ["-C", directory, ...args], {
      encoding: "utf8",
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
