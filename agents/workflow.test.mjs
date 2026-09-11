import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const workflow = readFileSync(
  new URL("../.github/workflows/ai.yml", import.meta.url),
  "utf8"
);
const codexWorkflow = readFileSync(
  new URL("../.github/workflows/codex-review.yml", import.meta.url),
  "utf8"
);

test("subscription persistence uses only the environment's reviewer App", () => {
  assert.match(codexWorkflow, /environment: codex-review/);
  assert.match(
    codexWorkflow,
    /client-id: \$\{\{ secrets.AI_REVIEW_APP_ID \}\}/
  );
  assert.match(
    codexWorkflow,
    /private-key: \$\{\{ secrets.AI_REVIEW_APP_PRIVATE_KEY \}\}/
  );
  assert.doesNotMatch(codexWorkflow, /\bAI_APP_ID\b|\bAI_APP_PRIVATE_KEY\b/);
  const declarations = codexWorkflow.split("jobs:", 1)[0];
  for (const secret of [
    "CODEX_AUTH_JSON",
    "AI_REVIEW_APP_ID",
    "AI_REVIEW_APP_PRIVATE_KEY"
  ]) {
    assert.ok(declarations.includes(`${secret}:`));
  }
  assert.equal(declarations.match(/required: false/g)?.length, 3);
});

test("subscription jobs serialize without replacing waiting reviews", () => {
  assert.match(codexWorkflow, /group: codex-subscription/);
  assert.match(codexWorkflow, /queue: max/);
  assert.match(codexWorkflow, /cancel-in-progress: false/);
  assert.match(codexWorkflow, /environment: codex-review/);
  assert.match(codexWorkflow, /github.event.repository.private == true/);
});

test("a failed Codex call still persists credentials before cleanup", () => {
  const call = codexWorkflow.indexOf("codex exec");
  const token = codexWorkflow.indexOf("permission-environments: write");
  const persist = codexWorkflow.indexOf("name: Persist the refreshed login");
  const clear = codexWorkflow.indexOf("name: Remove runner credentials");
  assert.ok(call < token && token < persist && persist < clear);
  assert.match(codexWorkflow.slice(persist, clear), /always\(\)/);
  assert.doesNotMatch(
    codexWorkflow.slice(persist, clear),
    /steps.codex.outcome == 'success'/
  );
  assert.match(codexWorkflow.slice(clear), /if: always\(\)/);
});

test("the subscription smoke test pins Astra medium and never loads consumer code", () => {
  assert.match(codexWorkflow, /@openai\/codex@0\.154\.0/);
  assert.match(codexWorkflow, /--model gpt-6-astra/);
  assert.match(codexWorkflow, /model_reasoning_effort="medium"/);
  assert.match(
    codexWorkflow,
    /--ignore-user-config --ignore-rules --ephemeral/
  );
  assert.match(codexWorkflow, /--sandbox read-only/);
  assert.match(codexWorkflow, /persist-credentials: false/);
  assert.doesNotMatch(
    codexWorkflow,
    /OPENAI_API_KEY|CODEX_API_KEY|upload-artifact|actions\/cache/
  );
});
const job = (name) =>
  workflow.split(`\n  ${name}:\n`)[1].split(/\n {2}[a-z-]+:\n/, 1)[0];
const condition = (name) =>
  ["plan-review", "pr-review"].includes(name)
    ? job(name)
        .match(/if:\n([\s\S]*?)\n {4}uses:/)[1]
        .trim()
    : job(name)
        .match(/\n {4}if:\n([\s\S]*?)\n {4}runs-on:/)[1]
        .trim();
const jobFor = {
  "implementer": "implement",
  "plan-reviewer": "plan-review",
  "planner": "plan",
  "pr-reviewer": "pr-review"
};
const eligible = ({ approval, role, route }) =>
  runInNewContext(condition(jobFor[role]), {
    always: () => true,
    needs: {
      approval: { result: approval },
      route: {
        outputs: {
          approval: role === "implementer" ? "verify" : "none",
          role
        },
        result: route
      }
    }
  });

for (const route of ["failure", "cancelled", "skipped"]) {
  for (const role of [
    "planner",
    "implementer",
    "plan-reviewer",
    "pr-reviewer"
  ]) {
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
  const decision = route.indexOf("run: node _tooling/agents/route-run.mjs");

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
    const started = steps.indexOf('reaction.sh" start');
    const action = steps.indexOf("uses: anthropics/claude-code-action@");
    const outcome = steps.indexOf("Replace the reaction with the outcome");

    assert.ok(started > 0 && started < action);
    assert.ok(outcome > action);
    assert.match(
      steps.slice(outcome),
      /if: always\(\) && steps.reaction.outputs.target != ''/
    );
    assert.match(steps.slice(outcome), /reaction.sh" finish/);
    assert.match(steps.slice(outcome), /OUTCOME: \$\{\{ job.status \}\}/);
  });
}

for (const role of ["plan", "implement"]) {
  test(`the ${role} job installs the coding style as user memory`, () => {
    assert.match(
      job(role),
      /cp "\$\{RUNNER_TEMP}\/tooling\/agents\/vendor\/coding-style\.md" "\$\{HOME}\/\.claude\/CLAUDE\.md"/
    );
  });
}

test("review can start without an approval job", () => {
  assert.equal(
    eligible({ approval: "skipped", role: "plan-reviewer", route: "success" }),
    true
  );
});

test("plan review uses the shared subscription queue without Claude credentials", () => {
  const review = job("plan-review");
  assert.match(review, /uses: \.\/.github\/workflows\/codex-review.yml/);
  assert.doesNotMatch(
    review,
    /CLAUDE_CODE|AI_APP_PRIVATE_KEY|cancel-in-progress/
  );
  assert.match(codexWorkflow, /permission-contents: read/);
  assert.doesNotMatch(
    codexWorkflow,
    /permission-contents: write|permission-pull-requests: write/
  );
});

test("the model cannot execute repository scripts or receive GitHub write tokens", () => {
  const model = codexWorkflow
    .split("name: Review with Astra", 2)[1]
    .split("# Mint this only after", 1)[0];
  assert.match(
    model,
    /--disable shell_tool --disable unified_exec --disable hooks/
  );
  assert.match(model, /--output-schema/);
  assert.doesNotMatch(model, /GH_TOKEN|AI_REVIEW_APP_PRIVATE_KEY/);
  assert.ok(
    codexWorkflow.indexOf("review-run.mjs prepare") <
      codexWorkflow.indexOf("name: Review with Astra")
  );
  assert.ok(
    codexWorkflow.indexOf("codex-auth.mjs clear") <
      codexWorkflow.indexOf("review-run.mjs publish")
  );
});

test("routing can read branch refs without repository write authority", () => {
  assert.match(job("route"), /permission-contents: read/);
  assert.doesNotMatch(job("route"), /permission-[\w-]+: write/);
});

test("parent tracking can change readiness using only the pinned tooling", () => {
  const tracker = job("delivery-progress");
  assert.match(tracker, /permission-contents: write/);
  assert.match(tracker, /permission-pull-requests: write/);
  assert.match(tracker, /repository: \$\{\{ job.workflow_repository \}\}/);
  assert.doesNotMatch(tracker, /claude-code-action|pnpm install|npm install/);
});

test("parent repair readiness is rechecked only after successful implementation", () => {
  const implement = job("implement");
  assert.match(
    implement,
    /Recheck repaired parent readiness\n\s+if: success\(\) && steps\.delivery\.outputs\.parent == 'true'/
  );
  assert.match(implement, /delivery-run\.mjs" progress/);
  assert.doesNotMatch(job("plan"), /Recheck repaired parent readiness/);
});

test("routing knows the App's own login so the planner can ask for review", () => {
  const route = job("route");

  assert.match(
    route,
    /APP_LOGIN: \$\{\{ steps.app-token.outputs.app-slug \}\}\[bot]/
  );
  assert.doesNotMatch(
    route.slice(0, route.indexOf("Read the sender's repository permission")),
    /if: github.event.sender.type == 'User'/
  );
});

test("PR reviews use the same subscription queue and only the reviewer credentials", () => {
  const review = job("pr-review");
  assert.match(review, /uses: \.\/.github\/workflows\/codex-review.yml/);
  assert.match(review, /mode: pr/);
  assert.doesNotMatch(
    review,
    /CLAUDE_CODE|AI_APP_PRIVATE_KEY|cancel-in-progress/
  );
  assert.match(codexWorkflow, /permission-actions: read/);
  assert.match(
    codexWorkflow,
    /permission-pull-requests:\s*\$\{\{ inputs.mode == 'pr' && 'write' \|\| 'read' \}\}/
  );
});
test("a duplicate PR review does not restore or spend the subscription login", () => {
  const auth = codexWorkflow
    .split("name: Restore the subscription login", 2)[1]
    .split("name: Check Astra", 1)[0];
  const model = codexWorkflow
    .split("name: Review with Astra", 2)[1]
    .split("# Mint this", 1)[0];
  assert.match(auth, /steps.prepare.outputs.prepared == 'true'/);
  assert.match(model, /steps.prepare.outputs.prepared == 'true'/);
});
test("only the trusted base is checked out and PR commits are read as data", () => {
  assert.match(codexWorkflow, /ref: \$\{\{ github.sha \}\}/);
  assert.match(codexWorkflow, /fetch-depth: 0/);
  assert.doesNotMatch(codexWorkflow, /ref:.*head|npm ci|pnpm install/);
});

test("automatic planning is claimed before model execution and admits only the verified builder bot", () => {
  const planner = job("plan");
  assert.ok(
    planner.indexOf('automation.mjs" claim') <
      planner.indexOf("uses: anthropics/claude-code-action")
  );
  assert.match(planner, /if: steps.correction.outputs.claimed == 'true'/);
  assert.match(
    planner,
    /allowed_bots:[\s\S]*?needs.route.outputs.automatic == 'true'/
  );
  assert.doesNotMatch(planner, /permission-contents: write/);
  assert.match(planner, /cancel-in-progress: false/);
});

test("automatic planner reactions target the resolved issue without an issue event payload", () => {
  const target = job("plan").split("TARGET:", 2)[1].split("run:", 1)[0];
  assert.match(target, /needs.route.outputs.issue/);
  assert.doesNotMatch(target, /github.event.issue.number/);
});

test("the planner model reads only and trusted publication completes before the job succeeds", () => {
  const planner = job("plan");
  const model = planner
    .split("uses: anthropics/claude-code-action", 2)[1]
    .split("- name: Publish", 1)[0];
  const reader = planner.split("id: reader-token", 2)[1].split("- name:", 1)[0];
  assert.match(
    model,
    /github_token: \$\{\{ steps.reader-token.outputs.token \}\}/
  );
  assert.match(reader, /permission-pull-requests: read/);
  assert.doesNotMatch(reader, /permission-[\w-]+: write/);
  assert.match(model, /--json-schema/);
  assert.match(
    planner,
    /PLANNER_RESULT: \$\{\{ steps.planner.outputs.structured_output \}\}/
  );
  assert.ok(
    planner.indexOf('planning-run.mjs" capture') <
      planner.indexOf("uses: anthropics/claude-code-action")
  );
  assert.ok(
    planner.indexOf('planning-run.mjs" publish') >
      planner.indexOf("uses: anthropics/claude-code-action")
  );
});

test("automatic repairs verify the recorded owner and claim work inside the shared writer queue", () => {
  const approval = job("approval");
  const implementer = job("implement");
  assert.match(
    approval,
    /ACTOR: \$\{\{ needs.route.outputs.owner \|\| github.actor \}\}/
  );
  assert.match(
    implementer,
    /ACTOR: \$\{\{ needs.route.outputs.owner \|\| github.actor \}\}/
  );
  assert.match(implementer, /queue: max/);
  assert.match(
    implementer,
    /EXPECTED_HEAD: \$\{\{ needs.route.outputs.head \}\}/
  );
  assert.ok(
    implementer.indexOf('repair-run.mjs" claim') <
      implementer.indexOf("uses: anthropics/claude-code-action")
  );
  assert.match(implementer, /if: steps.correction.outputs.claimed == 'true'/);
  assert.match(
    implementer,
    /allowed_bots:[\s\S]*?needs.route.outputs.automatic == 'true'/
  );
});

test("the builder checks out with write credentials only after approval and uses the repository runtime", () => {
  const implementer = job("implement");
  const checkout = implementer.indexOf(
    "\n          token: ${{ steps.app-token.outputs.token }}"
  );
  assert.ok(
    checkout >
      implementer.indexOf(
        "Recheck the queued proposal before granting write access"
      )
  );
  assert.match(implementer, /node-version-file:/);
  assert.match(implementer, /uses: pnpm\/action-setup@/);
});
