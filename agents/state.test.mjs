import assert from "node:assert/strict";
import test from "node:test";

import { readDevEvent, setStatus } from "./state.mjs";
const context = { issueNumber: "1", repository: "org/repo" };
test("status replacement preserves unrelated labels and is idempotent", () => {
  const writes = [];
  const request = (options) => {
    if (options.method) {
      writes.push(options);
      return;
    }
    return [{ name: "bug" }, { name: "learning" }];
  };
  setStatus(context, "in review", request);
  assert.equal(writes.length, 2);
  assert.match(writes[0].path, /learning$/);
  assert.deepEqual(writes[1].body, { labels: ["in review"] });
  setStatus(context, "approved", () => [{ name: "approved" }]);
});
test("latest authorization removal wins across all event pages", () => {
  const event = { event: "labeled", id: 1, label: { name: "ready for dev" } };
  assert.equal(readDevEvent(context, () => [[event]]).id, 1);
  assert.throws(
    () =>
      readDevEvent(context, () => [
        [event],
        [{ ...event, event: "unlabeled", id: 2 }]
      ]),
    /removed/
  );
});
