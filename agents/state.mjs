import { fileURLToPath } from "node:url";

import { githubRequest, readPages } from "./github.mjs";

const STATUSES = new Set([
  "approved",
  "blocked",
  "changes requested",
  "in development",
  "in review",
  "learning"
]);

/**
Bind owner authorization to an actual label event, including removal/reapplication.
*/
export function readDevEvent(context, callGitHub = githubRequest) {
  const events = readPages(
    `repos/${context.repository}/issues/${context.issueNumber}/events`,
    callGitHub
  );
  const latest = events
    .filter(
      (event) =>
        event.label?.name === "ready for dev" &&
        ["labeled", "unlabeled"].includes(event.event)
    )
    .toSorted((left, right) => right.id - left.id)[0];
  if (latest?.event !== "labeled" || !Number.isSafeInteger(latest.id)) {
    throw new Error("Owner authorization removed or missing");
  }
  return latest;
}

/**
Replace only our status labels, preserving user labels. Reconcile again after partial failures.
*/
export function setStatus(context, status, callGitHub = githubRequest) {
  if (!STATUSES.has(status)) {
    throw new Error("Invalid workflow status");
  }
  const path = `repos/${context.repository}/issues/${context.issueNumber}/labels`;
  const labels = callGitHub({ path });
  if (!Array.isArray(labels)) {
    throw new TypeError("Malformed labels");
  }
  for (const label of labels) {
    if (STATUSES.has(label.name) && label.name !== status) {
      callGitHub({
        method: "DELETE",
        path: `${path}/${encodeURIComponent(label.name)}`
      });
    }
  }
  if (labels.every((label) => label.name !== status)) {
    callGitHub({ body: { labels: [status] }, method: "POST", path });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const context = {
    issueNumber: process.env.ISSUE,
    repository: process.env.GITHUB_REPOSITORY
  };
  if (
    !/^[1-9]\d*$/.test(context.issueNumber) ||
    !/^[\w-]+\/[\w.-]+$/.test(context.repository)
  ) {
    throw new Error("Invalid status context");
  }
  setStatus(context, process.argv[2]);
}
