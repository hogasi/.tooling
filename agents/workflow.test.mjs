import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const workflow = readFileSync(
  new URL("../.github/workflows/ai.yml", import.meta.url),
  "utf8"
);
const job = (name) =>
  workflow.split(`\n  ${name}:\n`)[1].split(/\n {2}[a-z]+:\n/, 1)[0];
const condition = (name) =>
  job(name)
    .match(/\n {4}if:\n([\s\S]*?)\n {4}runs-on:/)[1]
    .trim();
const eligible = ({ approval, role, route }) =>
  runInNewContext(condition(role === "planner" ? "plan" : "implement"), {
    always: () => true,
    needs: {
      approval: { result: approval },
      route: {
        outputs: { approval: role === "planner" ? "none" : "verify", role },
        result: route
      }
    }
  });

for (const route of ["failure", "cancelled", "skipped"]) {
  for (const role of ["planner", "implementer"]) {
    test(`${role} never starts after ${route} routing`, () => {
      assert.equal(eligible({ approval: "skipped", role, route }), false);
    });
  }
}

for (const approval of ["failure", "cancelled", "skipped"]) {
  test(`implementation rejects ${approval} approval`, () => {
    assert.equal(
      eligible({ approval, role: "implementer", route: "success" }),
      false
    );
  });
}

test("implementation starts only after successful routing and approval", () => {
  assert.equal(
    eligible({ approval: "success", role: "implementer", route: "success" }),
    true
  );
});

test("discovery can start without an approval job", () => {
  assert.equal(
    eligible({ approval: "skipped", role: "planner", route: "success" }),
    true
  );
});

test("the serialized writer rechecks approval before receiving write credentials", () => {
  const implementation = job("implement");
  const recheck = implementation.indexOf(
    'node "${RUNNER_TEMP}/tooling/agents/approval.mjs"'
  );
  const writeToken = implementation.indexOf("permission-contents: write");
  const claude = implementation.indexOf("uses: anthropics/claude-code-action@");
  assert.match(implementation, /concurrency:[\s\S]*group: ai-write-/);
  assert.ok(recheck > 0, "No approval recheck inside the writer job");
  assert.ok(writeToken > recheck && claude > writeToken);
  assert.match(
    implementation,
    /EXPECTED_DIGEST: \$\{\{ needs.approval.outputs.digest \}\}/
  );
  assert.match(implementation, /MODE: verify/);
});

test("approval checks out its code and exposes the verified digest", () => {
  const approval = job("approval");
  assert.match(
    approval,
    /outputs:\n {6}digest: \$\{\{ steps.check.outputs.digest \}\}/
  );
  assert.ok(
    approval.indexOf("path: _tooling") <
      approval.indexOf("run: node _tooling/agents/approval.mjs")
  );
  assert.match(approval, /ref: \$\{\{ job.workflow_sha \}\}/);
  assert.equal((job("route").match(/\n {4}outputs:/g) ?? []).length, 1);
});

test("routing reads the sender's real permission before deciding", () => {
  const route = job("route");
  const lookup = route.indexOf("collaborators/${SENDER}/permission");
  const decision = route.indexOf("run: node _tooling/agents/route.mjs");

  assert.ok(lookup > 0, "The route job never reads the sender's permission");
  assert.ok(lookup < decision);
  assert.match(
    route,
    /EVENT_SENDER_PERMISSION: \$\{\{ steps.sender.outputs.permission \}\}/
  );
});

for (const role of ["plan", "implement"]) {
  test(`the ${role} job grants the GitHub tools agent mode installs on demand`, () => {
    assert.match(job(role), /--allowedTools\n\s+'mcp__github__\*'/);
  });
}

for (const role of ["plan", "implement"]) {
  test(`the ${role} job marks the thread before the model starts and after it ends`, () => {
    const steps = job(role);
    const started = steps.indexOf("content=eyes");
    const action = steps.indexOf("uses: anthropics/claude-code-action@");
    const outcome = steps.indexOf("Replace the reaction with the outcome");

    assert.ok(started > 0 && started < action);
    assert.ok(outcome > action);
    assert.match(steps.slice(outcome), /if: always\(\)/);
  });
}
