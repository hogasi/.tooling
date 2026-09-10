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
