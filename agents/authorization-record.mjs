import { latestComment, readComments } from "./proposal.mjs";

const MARKER = "<!-- hogasi-ai authorization ";

export function latestApproval(context, callGitHub) {
  const latest = latestComment({
    comments: readComments(context, callGitHub),
    login: context.appLogin,
    marker: MARKER
  });
  if (!latest) {
    return;
  }
  const line = latest.body.split("\n", 1)[0];
  if (!line.endsWith(" -->")) {
    throw new Error("Malformed approval record");
  }
  const record = JSON.parse(line.slice(MARKER.length, -4));
  if (record.cleared === true) {
    return record;
  }
  if (
    !/^[a-f0-9]{64}$/.test(record.digest) ||
    !Number.isSafeInteger(record.proposal) ||
    !Number.isSafeInteger(record.event) ||
    !/^[\w-]+$/.test(record.actor)
  ) {
    throw new Error("Malformed approval record");
  }
  return record;
}

export function verifyApproval(context, { event, proposal }, callGitHub) {
  const approval = latestApproval(context, callGitHub);
  if (!approval || approval.cleared) {
    throw new Error(
      "No approval or approval revoked; authorize the proposal revision"
    );
  }
  if (
    approval.digest !== proposal.digest ||
    approval.proposal !== proposal.id ||
    approval.event !== event.id
  ) {
    throw new Error("Proposal or owner authorization changed since approval");
  }
  if (
    context.expectedDigest !== undefined &&
    context.expectedDigest !== proposal.digest
  ) {
    throw new Error("The queued proposal changed");
  }
  return approval;
}
