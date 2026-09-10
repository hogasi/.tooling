import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { clearAuth, persistAuth, restoreAuth } from "./codex-auth.mjs";

const credential = (value) =>
  JSON.stringify({
    auth_mode: "chatgpt",
    tokens: {
      access_token: `test-access-${value}`,
      refresh_token: `test-refresh-${value}`
    }
  });

function fixture(context) {
  const directory = mkdtempSync(path.join(tmpdir(), "codex-auth-test-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  return directory;
}

test("restores subscription credentials with private file permissions", (context) => {
  const directory = fixture(context);
  restoreAuth({ directory, value: credential("original") });
  assert.equal(
    readFileSync(path.join(directory, "auth.json"), "utf8"),
    credential("original")
  );
  assert.equal(statSync(path.join(directory, "auth.json")).mode & 0o777, 0o600);
  assert.equal(statSync(directory).mode & 0o777, 0o700);
});

for (const value of [
  "",
  "not json",
  "null",
  "{}",
  '{"auth_mode":"apikey"}',
  JSON.stringify({ auth_mode: "chatgpt", tokens: { access_token: "test" } }),
  JSON.stringify({
    ...JSON.parse(credential("mixed")),
    OPENAI_API_KEY: "test-api"
  })
]) {
  test(`rejects invalid or API authentication (${value.length} characters)`, (context) => {
    const directory = fixture(context);
    assert.throws(
      () => restoreAuth({ directory, value }),
      /subscription credentials/
    );
  });
}

test("persists the refreshed file, not the original secret", (context) => {
  const directory = fixture(context);
  restoreAuth({ directory, value: credential("original") });
  writeFileSync(path.join(directory, "auth.json"), credential("refreshed"));
  const writes = [];
  persistAuth({ directory, repository: "hogasi/ai-sandbox" }, (input) => {
    writes.push(input);
  });
  assert.deepEqual(writes, [
    { repository: "hogasi/ai-sandbox", value: credential("refreshed") }
  ]);
});

test("refuses to overwrite the saved login with a corrupt refreshed file", (context) => {
  const directory = fixture(context);
  restoreAuth({ directory, value: credential("original") });
  writeFileSync(path.join(directory, "auth.json"), "null");
  assert.throws(
    () =>
      persistAuth({ directory, repository: "hogasi/ai-sandbox" }, () =>
        assert.fail("must not write corrupt credentials")
      ),
    /subscription credentials/
  );
});

test("a persistence failure remains a failure and allows cleanup", (context) => {
  const directory = fixture(context);
  restoreAuth({ directory, value: credential("original") });
  assert.throws(
    () =>
      persistAuth({ directory, repository: "hogasi/ai-sandbox" }, () => {
        throw new Error("write failed");
      }),
    /write failed/
  );
  clearAuth(directory);
  assert.throws(() => readFileSync(path.join(directory, "auth.json")), {
    code: "ENOENT"
  });
});

test("rejects invalid repository names before sending credentials", (context) => {
  const directory = fixture(context);
  restoreAuth({ directory, value: credential("original") });
  assert.throws(
    () =>
      persistAuth({ directory, repository: "--repo evil" }, () =>
        assert.fail("must not send credentials")
      ),
    /repository/
  );
});
