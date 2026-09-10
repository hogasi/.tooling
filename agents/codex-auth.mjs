import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AUTH_ERROR =
  "Invalid Codex subscription credentials; reseed with a dedicated Codex login";

/**
Remove authentication and any local session files after persistence is attempted.
*/
export function clearAuth(directory) {
  rmSync(directory, { force: true, recursive: true });
}

/**
Save the current file, including any refresh performed by Codex.
*/
export function persistAuth(
  { directory, repository },
  writeSecret = saveSecret
) {
  if (!/^[\w-]+\/[\w.-]+$/.test(repository)) {
    throw new Error("Invalid credential destination repository");
  }
  // fallow-ignore-next-line security-sink -- The directory comes only from RUNNER_TEMP or an isolated test fixture, never repository content.
  const value = readFileSync(path.join(directory, "auth.json"), "utf8"); // eslint-disable-line security/detect-non-literal-fs-filename -- Trusted runner temp directory.
  requireSubscription(value);
  writeSecret({ repository, value });
}

/**
Restore only ChatGPT-managed auth; the caller supplies a trusted temp directory.
*/
export function restoreAuth({ directory, value }) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(
      "CODEX_AUTH_JSON is missing or empty; check the codex-review environment secret and reusable workflow declarations"
    );
  }
  requireSubscription(value);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- The workflow supplies a dedicated runner temp directory, never repository input.
  mkdirSync(directory, { mode: 0o700, recursive: true });
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- The workflow supplies a dedicated runner temp directory, never repository input.
  chmodSync(directory, 0o700);
  // fallow-ignore-next-line security-sink -- The directory comes only from RUNNER_TEMP or an isolated test fixture, never repository content.
  const file = path.join(directory, "auth.json");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Trusted runner temp directory.
  writeFileSync(file, value, {
    flag: "wx",
    mode: 0o600
  });
}

function isInvalidToken(token) {
  return typeof token !== "string" || token.trim().length === 0;
}

function main() {
  if (!process.env.RUNNER_TEMP) {
    throw new Error("RUNNER_TEMP is required");
  }
  // fallow-ignore-next-line security-sink -- The directory comes only from RUNNER_TEMP or an isolated test fixture, never repository content.
  const directory = path.join(process.env.RUNNER_TEMP, "codex-review-auth");
  const commands = new Map([
    ["clear", () => clearAuth(directory)],
    [
      "persist",
      () =>
        persistAuth({ directory, repository: process.env.GITHUB_REPOSITORY })
    ],
    [
      "restore",
      () => restoreAuth({ directory, value: process.env.CODEX_AUTH_JSON })
    ]
  ]);
  const command = commands.get(process.argv[2]);
  if (!command) {
    throw new Error("Use codex-auth.mjs restore|persist|clear");
  }
  command();
}

function parseAuth(value) {
  try {
    return JSON.parse(value);
  } catch {
    // JSON parser errors can include the token that failed to parse.
    throw new Error(AUTH_ERROR);
  }
}

function requireSubscription(value) {
  const auth = parseAuth(value);
  if (
    auth?.auth_mode !== "chatgpt" ||
    auth.OPENAI_API_KEY ||
    [auth.tokens?.access_token, auth.tokens?.refresh_token].some((token) =>
      isInvalidToken(token)
    )
  ) {
    throw new Error(AUTH_ERROR);
  }
}

function saveSecret({ repository, value }) {
  try {
    execFileSync(
      "gh",
      [
        "secret",
        "set",
        "CODEX_AUTH_JSON",
        "--repo",
        repository,
        "--env",
        "codex-review"
      ],
      { input: value, stdio: ["pipe", "ignore", "ignore"] }
    );
  } catch {
    throw new Error(
      "Could not persist Codex login; disable reviews and reseed before retrying"
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
