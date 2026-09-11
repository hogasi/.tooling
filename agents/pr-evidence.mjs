import { createHash } from "node:crypto";

import { readPages } from "./github.mjs";

export function readPullEvidence(context, pull, callGitHub) {
  const comments = readPages(
    `repos/${context.repository}/issues/${pull.number}/comments`,
    callGitHub
  );
  const evidence = {
    body: pull.body ?? "",
    comments: comments.map(({ body, id, user }) => ({
      author: user?.login,
      body,
      id
    }))
  };
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(evidence))
    .digest("hex");
  return { comments, fingerprint };
}
