import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const preset = JSON.parse(
  readFileSync(new URL("default.json", import.meta.url), "utf8")
);

const rulesMatching = (updateType) =>
  preset.packageRules.filter((rule) =>
    rule.matchUpdateTypes?.includes(updateType)
  );

test("builds on the recommended Renovate config", () => {
  assert.ok(preset.extends.includes("config:recommended"));
});

test("security alerts automerge on their own", () => {
  // They bypass packageRules entirely, so without this they inherit the global
  // `automerge: false` and sit unmerged.
  assert.equal(preset.vulnerabilityAlerts.automerge, true);
});

test("no major update is ever automerged", () => {
  const majors = rulesMatching("major");

  assert.ok(majors.length > 0, "expected a rule covering major updates");
  assert.ok(majors.every((rule) => rule.automerge !== true));
});

test("every rule selects a subset rather than everything", () => {
  for (const [index, rule] of preset.packageRules.entries()) {
    const selectors = Object.keys(rule).filter((key) =>
      key.startsWith("match")
    );

    assert.ok(
      selectors.length > 0,
      `packageRules[${index}] matches every dependency`
    );
  }
});
