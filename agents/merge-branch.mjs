import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { isolatedGitEnvironment } from "./git-environment.mjs";

export function mergeBranch({ appLogin, base, branch, head, remote }) {
  if (
    !/^claude\/issue-[1-9]\d*$/.test(branch) ||
    [head, base].some((sha) => !/^[a-f0-9]{40}$/.test(sha))
  ) {
    throw new Error("Invalid stack branch or commit");
  }
  // fallow-ignore-next-line security-sink -- Fixed prefix under the runner's temporary directory; no repository input supplies a path.
  const directory = mkdtempSync(path.join(tmpdir(), "stack-merge-"));
  const git = gitCommand({ appLogin, directory });
  try {
    mergeAndPush(git, { base, branch, head, remote });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

function gitCommand({ appLogin, directory }) {
  const config = [
    "core.hooksPath=/dev/null",
    "credential.helper=",
    "credential.helper=!gh auth git-credential",
    `user.name=${appLogin}`,
    `user.email=${appLogin}@users.noreply.github.com`
  ].flatMap((value) => ["-c", value]);
  return (...args) =>
    execFileSync("git", ["-C", directory, ...config, ...args], {
      encoding: "utf8",
      env: isolatedGitEnvironment(),
      stdio: ["pipe", "pipe", "pipe"]
    }).trim();
}

function mergeAndPush(git, { base, branch, head, remote }) {
  // A bare repository merges objects without checking out or executing consumer files.
  git("init", "--bare");
  git("remote", "add", "origin", remote);
  git("fetch", "--no-tags", "origin", head, base);
  const tree = git("merge-tree", "--write-tree", head, base);
  const commit = git(
    "commit-tree",
    tree,
    "-p",
    head,
    "-p",
    base,
    "-m",
    `Merge approved base into ${branch}`
  );
  const current = git("ls-remote", "origin", `refs/heads/${branch}`).split(
    "\t",
    1
  )[0];
  if (current !== head) {
    throw new Error("Stack branch changed during refresh");
  }
  // A normal push also rejects a concurrent diverging edit after the head check.
  git("push", "origin", `${commit}:refs/heads/${branch}`);
}
