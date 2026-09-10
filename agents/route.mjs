/**
 * Decides which AI role a GitHub event starts, and how that role is invoked.
 *
 * This is policy rather than plumbing, which is why it is a tested module and
 * not a `case` statement inside the workflow. Two things live here:
 *
 * - The routing table, which is the executable form of the event table in
 *   docs/stage-2-ai-layer.md. Getting it wrong lets a bot or a stranger start
 *   a run, or restarts implementation on an ordinary comment.
 * - The model and effort resolvers, which are the trust boundary for the
 *   Actions variables an enrolled repository can set. Their values reach a
 *   command line, so an unrecognised one fails the run rather than being
 *   passed through.
 */
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const AUTHORIZED_ASSOCIATIONS = new Set(["COLLABORATOR", "MEMBER", "OWNER"]);
const OWNER_ASSOCIATION = "OWNER";
const DEV_LABEL = "ready for dev";
const READY_LABEL = "ready";
const REVIEWED_LABEL = "reviewed";
const REPAIR_PATTERN = /(?:^|\s)@claude(?![\w-])/i;
const REPAIR_PHRASE = "@claude";
const REPLAN_PATTERN = /(?:^|\s)@claude\s+replan\b/i;
const WRITE_PERMISSIONS = new Set(["admin", "write"]);

/**
 * `ultracode` is a supported `--effort` value and is deliberately missing: it
 * lets the model raise its own effort mid-run, which is not a decision an
 * unattended job should be making against a metered subscription.
 */
const EFFORT_LEVELS = new Set(["high", "low", "max", "medium", "xhigh"]);
const MODEL_ALIASES = new Set(["best", "fable", "haiku", "opus", "sonnet"]);
const MODEL_ID = /^claude-[a-z\d-]+(?:\[1m])?$/;

const skip = (reason) => ({ approval: "none", reason, role: "" });

const text = (value) => value ?? "";

/**
 * Quoting a comment that mentions `@claude` — a reply quoting the App's own
 * status update, say — must not start a run.
 */
const unquoted = (body) =>
  body
    .split("\n")
    .filter((line) => !line.trimStart().startsWith(">"))
    .join("\n");

/**
 * `author_association` describes the person a payload object belongs to, not
 * whoever triggered the event. On a label event the issue's association is the
 * opener's, so trusting it would deny an owner approving an outside
 * contributor's issue and admit the reverse. The association is used only when
 * it describes the sender; labelling uses the sender's real repository permission
 * read by the route job, then checked again for approval operations.
 *
 * The association is also a social label rather than a grant: MEMBER says only
 * that the sender belongs to the org, and COLLABORATOR that they are listed on
 * the repository, neither of which implies write access. So the sender's real
 * repository permission, read back in the route job, decides. OWNER is the
 * exception — it is the account the repository belongs to — and the
 * associations stay in use for the message, which is the difference between a
 * stranger and a read-only insider.
 */
const associationAuthority = ({
  authorAssociation,
  senderLogin,
  senderPermission
}) => {
  if (
    authorAssociation === OWNER_ASSOCIATION ||
    WRITE_PERMISSIONS.has(senderPermission)
  ) {
    return "";
  }

  return AUTHORIZED_ASSOCIATIONS.has(authorAssociation)
    ? `${senderLogin} does not have write access to this repository`
    : `${senderLogin} has no write relationship with this repository`;
};

const labelAuthority = ({
  action,
  eventName,
  senderLogin,
  senderPermission
}) =>
  eventName === "issues" &&
  action === "labeled" &&
  WRITE_PERMISSIONS.has(senderPermission)
    ? ""
    : `this event does not establish write authority for ${senderLogin}`;

const senderAuthority = (event) =>
  event.senderLogin === event.associationSubject
    ? associationAuthority(event)
    : labelAuthority(event);

/**
 * The planner applies `ready` as the App, so the review it asks for arrives as
 * a bot event. This is the only bot event that starts a role: the App's own
 * login, on that one label, on an issue. The login comes from the workflow's
 * App-token step rather than from the payload, so a comment claiming to be the
 * App does not qualify.
 */
const isReadyLabelEvent = ({ action, eventName, labelName }) =>
  eventName === "issues" && action === "labeled" && labelName === READY_LABEL;

const isTheApp = ({ appLogin, senderLogin }) =>
  appLogin !== "" && senderLogin === appLogin;

const isReviewRequest = (event) => isReadyLabelEvent(event) && isTheApp(event);

const isBot = (event) =>
  event.senderType !== "User" || event.senderLogin.endsWith("[bot]");

const authorizationFailure = (event) => {
  if (isBot(event)) {
    return isReviewRequest(event)
      ? ""
      : `${event.senderLogin} is not a human account`;
  }

  return senderAuthority(event);
};

const readEvent = (environment) => ({
  action: text(environment.EVENT_ACTION),
  appLogin: text(environment.APP_LOGIN),
  associationSubject: text(environment.EVENT_ASSOCIATION_SUBJECT),
  authorAssociation: text(environment.EVENT_AUTHOR_ASSOCIATION),
  commentBody: text(environment.EVENT_COMMENT_BODY),
  eventName: text(environment.EVENT_NAME),
  isPullRequest: environment.EVENT_IS_PULL_REQUEST === "true",
  labelName: text(environment.EVENT_LABEL),
  labels: environment.EVENT_LABELS ? JSON.parse(environment.EVENT_LABELS) : [],
  senderLogin: text(environment.EVENT_SENDER),
  senderPermission: text(environment.EVENT_SENDER_PERMISSION),
  senderType: text(environment.EVENT_SENDER_TYPE)
});

const routeIssueComment = ({ commentBody, labels }) => {
  if (REPLAN_PATTERN.test(unquoted(commentBody))) {
    return {
      approval: "clear",
      reason: "replanning was requested, so any approval no longer holds",
      role: "planner"
    };
  }

  if (labels.includes(DEV_LABEL)) {
    return skip(
      "the proposal is approved; an ordinary comment restarts nothing"
    );
  }

  return { approval: "none", reason: "discovery continues", role: "planner" };
};

const routeIssueEdited = ({ labels }) =>
  labels.includes(DEV_LABEL)
    ? {
        approval: "clear",
        reason: "the approved proposal was edited and needs approving again",
        role: ""
      }
    : skip("editing an unapproved issue changes nothing");

const routeIssueLabeled = ({ labelName, labels }) => {
  if (labelName === READY_LABEL) {
    return {
      approval: "none",
      reason: "the planner marked the proposal ready for review",
      role: "plan-reviewer"
    };
  }

  if (labelName !== DEV_LABEL) {
    return skip(`the ${labelName} label starts nothing`);
  }

  requireReviewedProposal(labels);

  return {
    approval: "record",
    reason: "an owner approved the reviewed proposal in the issue body",
    role: "implementer"
  };
};

/**
 * `ready` says the planner has nothing material left to decide and `reviewed`
 * says the plan reviewer found nothing to fix. Approving without either approves a
 * proposal that is still moving, so it fails rather than implementing.
 */
const requireReviewedProposal = (labels) => {
  const missing = [READY_LABEL, REVIEWED_LABEL].filter(
    (label) => !labels.includes(label)
  );

  if (missing.length > 0) {
    throw new Error(
      `Approved without the ${missing.join(" and ")} label. The planner ` +
        `applies ${READY_LABEL} and the plan reviewer applies ${REVIEWED_LABEL}.`
    );
  }
};

const routePullRequestComment = ({ commentBody }) =>
  REPAIR_PATTERN.test(unquoted(commentBody))
    ? {
        approval: "verify",
        reason: "a repair was requested on the pull request",
        role: "implementer"
      }
    : skip(`a pull request comment starts a repair only with ${REPAIR_PHRASE}`);

const routes = new Map([
  ["issue_comment.created", routeIssueComment],
  ["issue_comment.created.pull_request", routePullRequestComment],
  ["issues.edited", routeIssueEdited],
  ["issues.labeled", routeIssueLabeled],
  [
    "issues.opened",
    () => ({
      approval: "none",
      reason: "a new issue starts discovery",
      role: "planner"
    })
  ]
]);

const gatedRole = ({ approval, role }) => {
  if (role !== "") {
    return role;
  }

  return approval === "none" ? "" : "implementer";
};

/**
 * The approval state matters only to the implementer, so a decision that
 * carries no role but does carry approval work — an edit that invalidates an
 * approval — is gated on the implementer being enabled. A decision that starts
 * nothing at all is already the answer, and gating it would replace the reason
 * the run was skipped with a misleading one about AI_ROLES.
 */
export function decide(environment) {
  const decision = resolveRoute(readEvent(environment));
  const gate = gatedRole(decision);

  if (gate === "") {
    return decision;
  }

  return resolveEnabledRoles(environment.AI_ROLES).has(gate)
    ? decision
    : skip(`${gate} is not in AI_ROLES`);
}

export function resolveEffort({ fallback, override }) {
  const value = selected(override, fallback);

  if (EFFORT_LEVELS.has(value)) {
    return value;
  }

  throw new Error(
    `Unsupported Claude effort "${value}". Use one of ` +
      `${[...EFFORT_LEVELS].join(", ")}.`
  );
}

/**
 * Unset means disabled. A repository opts in one role at a time by naming it.
 */
export function resolveEnabledRoles(raw) {
  return new Set(
    text(raw)
      .split(",")
      .map((role) => role.trim())
      .filter(Boolean)
  );
}

export function resolveModel({ fallback, override }) {
  const value = selected(override, fallback);

  if (MODEL_ALIASES.has(value) || MODEL_ID.test(value)) {
    return value;
  }

  throw new Error(
    `Unsupported Claude model "${value}". Use an alias ` +
      `(${[...MODEL_ALIASES].join(", ")}) or an explicit claude-* id.`
  );
}

/**
 * @param {object} event
 * @returns {{ approval: string, reason: string, role: string }}
 */
export function resolveRoute(event) {
  const failure = authorizationFailure(event);

  if (failure) {
    return skip(failure);
  }

  const key = event.isPullRequest
    ? `${event.eventName}.${event.action}.pull_request`
    : `${event.eventName}.${event.action}`;
  const route = routes.get(key);

  return route ? route(event) : skip(`no rule matches ${key}`);
}

const selected = (override, fallback) => {
  const trimmed = text(override).trim();

  return trimmed === "" ? fallback : trimmed;
};

const ROLE_SETTINGS = new Map([
  [
    "implementer",
    (environment) => ({
      defaultModel: environment.AI_DEFAULT_IMPLEMENTER_MODEL,
      effort: environment.AI_IMPLEMENTER_EFFORT,
      model: environment.AI_IMPLEMENTER_MODEL
    })
  ],
  [
    "planner",
    (environment) => ({
      defaultModel: environment.AI_DEFAULT_PLANNER_MODEL,
      effort: environment.AI_PLANNER_EFFORT,
      model: environment.AI_PLANNER_MODEL
    })
  ]
]);

/**
 * Resolves the model and effort a role runs with. The workflow's own defaults
 * are the fallbacks, so an enrolled repository that sets no variables gets
 * whatever shipped with the version of the workflow it pinned.
 */
export function settingsFor(role, environment) {
  if (role === "plan-reviewer") {
    return reviewSettings(environment);
  }
  const read = ROLE_SETTINGS.get(role);

  if (!read) {
    return { effort: "", model: "" };
  }

  const chosen = read(environment);

  return {
    effort: resolveEffort({
      fallback: environment.AI_DEFAULT_EFFORT,
      override: chosen.effort
    }),
    model: resolveModel({
      fallback: chosen.defaultModel,
      override: chosen.model
    })
  };
}

function main() {
  const environment = process.env;
  const decision = decide(environment);
  const settings = settingsFor(decision.role, environment);

  // eslint-disable-next-line security/detect-non-literal-fs-filename -- GITHUB_OUTPUT is the runner's own path, and nothing else can set it.
  appendFileSync(
    environment.GITHUB_OUTPUT,
    Object.entries({ ...decision, ...settings })
      .map(([key, value]) => `${key}=${value}\n`)
      .join("")
  );
}

/**
Keep the subscription pilot on the verified model and supported review efforts.
*/
function reviewSettings(environment) {
  const model = selected(environment.AI_PLAN_REVIEWER_MODEL, "gpt-6-astra");
  const effort = selected(environment.AI_PLAN_REVIEWER_EFFORT, "medium");
  if (model !== "gpt-6-astra" || !["low", "medium"].includes(effort)) {
    throw new Error(
      "Unsupported Codex review settings; use gpt-6-astra with low or medium effort"
    );
  }
  return { effort, model };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
