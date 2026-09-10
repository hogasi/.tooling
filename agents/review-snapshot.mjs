import { execFileSync } from "node:child_process";

// silviu: bound the tool-free pilot prompt; add scoped read-only retrieval before enrolling larger repositories.
const MAX_INPUT_BYTES = 512 * 1024;

/**
Read the PR's three-dot diff with external diff drivers and text converters disabled.
*/
export function pullRequestSnapshot({ base, directory, head }) {
  if ([base, head].some((sha) => !/^[a-f0-9]{40}$/.test(sha))) {
    throw new Error("Invalid PR snapshot SHA");
  }
  const diff = execFileSync(
    "git",
    [
      "-C",
      directory,
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--no-renames",
      `${base}...${head}`
    ],
    { encoding: "utf8", maxBuffer: MAX_INPUT_BYTES }
  );
  const snapshot = {
    baseFiles: repositorySnapshot({ directory, sha: base }),
    diff,
    files: repositorySnapshot({ directory, sha: head })
  };
  requireInputSize(JSON.stringify(snapshot));
  return snapshot;
}

/**
Read committed blobs without checking out files, following symlinks, or running hooks.
*/
export function repositorySnapshot({ directory, sha }) {
  if (!/^[a-f0-9]{40}$/.test(sha)) {
    throw new Error("Invalid snapshot SHA");
  }
  const git = (args) =>
    execFileSync("git", ["-C", directory, ...args], {
      maxBuffer: MAX_INPUT_BYTES
    });
  const entries = git(["ls-tree", "-rz", sha])
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  const files = entries.map((entry) => readBlob(entry, git));
  requireInputSize(JSON.stringify(files));
  return files;
}

/**
Fail before invoking the model instead of silently dropping evidence.
*/
export function requireInputSize(input) {
  if (Buffer.byteLength(input, "utf8") > MAX_INPUT_BYTES) {
    throw new Error(
      "Review input exceeds the 512 KiB pilot limit; scoped retrieval is required"
    );
  }
}

function readBlob(entry, git) {
  const [metadata, ...nameParts] = entry.split("\t");
  const [mode, type, object] = metadata.split(" ", 3);
  if (type !== "blob") {
    throw new Error("Submodules need a separate review snapshot");
  }
  const name = nameParts.join("\t");
  const bytes = git(["cat-file", "blob", object]);
  try {
    return {
      content: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      mode,
      name
    };
  } catch {
    return {
      content: null,
      mode,
      name,
      unavailable: "Binary content; cannot assess visually"
    };
  }
}
