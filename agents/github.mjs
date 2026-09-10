import { execFileSync } from "node:child_process";

export function githubRequest({ body, method = "GET", paginate, path }) {
  const args = ["api", path, "--method", method];
  if (paginate) {
    args.push("--paginate", "--slurp");
  }
  if (body) {
    args.push("--input", "-");
  }
  const output = execFileSync("gh", args, {
    encoding: "utf8",
    input: JSON.stringify(body)
  });
  return output.trim() ? JSON.parse(output) : undefined;
}

/**
Read the object-wrapped list endpoints used by Actions without dropping pages.
*/
export function readActionsPages(
  { collection, path },
  callGitHub = githubRequest
) {
  const selectors = new Map([
    ["jobs", (page) => page.jobs],
    ["workflow_runs", (page) => page.workflow_runs]
  ]);
  const select = selectors.get(collection);
  if (!select) {
    throw new Error("Unknown Actions collection");
  }
  const pages = callGitHub({ paginate: true, path });
  if (!Array.isArray(pages)) {
    throw new TypeError("Malformed Actions pages");
  }
  const lists = pages.map((page) => select(page));
  if (lists.some((list) => !Array.isArray(list))) {
    throw new TypeError("Malformed Actions collection");
  }
  return lists.flat();
}

/**
Read list endpoints completely; reject malformed pages rather than dropping records.
*/
export function readPages(path, callGitHub = githubRequest) {
  const pages = callGitHub({ paginate: true, path });
  if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) {
    throw new Error("Malformed GitHub list pages");
  }
  return pages.flat();
}
