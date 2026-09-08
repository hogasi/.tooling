#!/usr/bin/env sh
# Applies org-level GitHub settings from the JSON files in this directory.
# Requires: gh auth refresh -h github.com -s admin:org
set -eu
cd "$(dirname "$0")"
ORG=hogasi

gh api -X PUT "orgs/$ORG/actions/permissions" --input actions-permissions.json
gh api -X PUT "orgs/$ORG/actions/permissions/selected-actions" --input actions-allowed.json
gh api -X PUT "orgs/$ORG/actions/permissions/workflow" --input actions-workflow-permissions.json

ruleset_name=$(jq -r .name ruleset-main.json)
ruleset_id=$(gh api --paginate "orgs/$ORG/rulesets" --jq ".[] | select(.name == \"$ruleset_name\") | .id")

if [ -n "$ruleset_id" ]; then
  gh api -X PUT "orgs/$ORG/rulesets/$ruleset_id" --input ruleset-main.json >/dev/null
  echo "updated ruleset $ruleset_id"
else
  gh api -X POST "orgs/$ORG/rulesets" --input ruleset-main.json >/dev/null
  echo "created ruleset '$ruleset_name'"
fi
