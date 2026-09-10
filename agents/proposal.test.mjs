import assert from "node:assert/strict";
import test from "node:test";

import { readProposal } from "./proposal.mjs";
const context = {
  appLogin: "builder[bot]",
  issueNumber: "1",
  repository: "org/repo"
};
const checkpoint = {
  body: "<!-- hogasi-ai proposal -->\nThe approved deliverable.",
  created_at: "2026-09-10T10:00:00Z",
  id: 10,
  updated_at: "2026-09-10T10:00:00Z",
  user: { login: context.appLogin }
};
const summary = {
  body: '<!-- hogasi-ai planning {"proposal":10} -->\nCurrent plan',
  id: 11,
  user: { login: context.appLogin }
};
const read = (comments) => readProposal(context, () => [comments]);
test("summary edits do not change scope; checkpoint identity does", () => {
  const first = read([checkpoint, summary]);
  assert.equal(
    first.digest,
    read([checkpoint, { ...summary, body: summary.body + "\nProgress" }]).digest
  );
  assert.notEqual(
    first.digest,
    read([
      { ...checkpoint, id: 12 },
      { ...summary, body: '<!-- hogasi-ai planning {"proposal":12} -->' }
    ]).digest
  );
});
for (const comments of [
  [],
  [checkpoint],
  [summary],
  [{ ...checkpoint, updated_at: "2026-09-10T11:00:00Z" }, summary],
  [checkpoint, summary, { ...checkpoint, id: 12 }],
  [{ ...checkpoint, user: { login: "human" } }, summary]
]) {
  test(`reject missing, edited, forged or superseded checkpoint ${JSON.stringify(comments)}`, () =>
    assert.throws(() => read(comments)));
}
test("pagination includes the referenced revision", () => {
  assert.equal(readProposal(context, () => [[checkpoint], [summary]]).id, 10);
});
