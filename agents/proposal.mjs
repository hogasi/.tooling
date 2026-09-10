import { createHash } from "node:crypto";

import { githubRequest, readPages } from "./github.mjs";

const PROPOSAL = "<!-- hogasi-ai proposal -->\n";
const SUMMARY = "<!-- hogasi-ai planning ";

export function latestComment({ comments, login, marker }) {
  return comments
    .filter(
      (comment) =>
        comment.user?.login === login && comment.body?.startsWith(marker)
    )
    .toSorted((left, right) => right.id - left.id)[0];
}

export function readCheckpoint(context, id, callGitHub = githubRequest) {
  const comment = readComments(context, callGitHub).find(
    (entry) =>
      entry.id === id &&
      entry.user?.login === context.appLogin &&
      entry.body?.startsWith(PROPOSAL)
  );
  if (!comment) {
    throw new Error("Original parent checkpoint is missing");
  }
  return checkpoint(comment);
}

export function readComments(context, callGitHub = githubRequest) {
  return readPages(
    `repos/${context.repository}/issues/${context.issueNumber}/comments`,
    callGitHub
  );
}

/**
The summary points to a frozen checkpoint; neither status nor issue text is scope.
*/
export function readProposal(context, callGitHub = githubRequest) {
  const authored = readComments(context, callGitHub).filter(
    (comment) => comment.user?.login === context.appLogin
  );
  const summary = authored
    .filter((comment) => comment.body?.startsWith(SUMMARY))
    .toSorted((left, right) => right.id - left.id)[0];
  if (!summary) {
    throw new Error(
      "No proposal checkpoint; migrate this issue before approval"
    );
  }
  const line = summary.body.split("\n", 1)[0];
  if (!line.endsWith(" -->")) {
    throw new Error("Malformed planning summary");
  }
  const pointer = JSON.parse(line.slice(SUMMARY.length, -4));
  const latest = authored
    .filter((comment) => comment.body?.startsWith(PROPOSAL))
    .toSorted((left, right) => right.id - left.id)[0];
  if (
    !Number.isSafeInteger(pointer.proposal) ||
    latest?.id !== pointer.proposal
  ) {
    throw new Error(
      "Proposal checkpoint missing or superseded; update the planning summary"
    );
  }
  return checkpoint(latest);
}

function checkpoint(latest) {
  if (!latest.created_at || latest.created_at !== latest.updated_at) {
    throw new Error("Proposal checkpoint was edited; publish a new revision");
  }
  const body = latest.body.slice(PROPOSAL.length);
  if (!body.trim()) {
    throw new Error("Empty proposal checkpoint");
  }
  const digest = createHash("sha256")
    .update(`${latest.id}\n${body}`)
    .digest("hex");
  return { body, createdAt: latest.created_at, digest, id: latest.id };
}
