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

const APPROVED_LABEL = "approved";
const AUTHORIZED_ASSOCIATIONS = new Set(["COLLABORATOR", "MEMBER", "OWNER"]);
const READY_LABEL = "ready";
const REPAIR_PATTERN = /(?:^|\s)@claude(?![\w-])/i;
const REPAIR_PHRASE = "@claude";
const REPLAN_PATTERN = /(?:^|\s)@claude\s+replan\b/i;

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
 * it describes the sender; labelling is instead authorised in the approval job,
 * which has a token that can read the labeller's real repository permission.
 */
const associationAuthority = ({ authorAssociation, senderLogin }) =>
  AUTHORIZED_ASSOCIATIONS.has(authorAssociation)
    ? ""
    : `${senderLogin} has no write relationship with this repository`;

const labelAuthority = ({ action, eventName, senderLogin }) =>
  eventName === "issues" && action === "labeled"
    ? ""
    : `this event carries no author_association for ${senderLogin}`;

const senderAuthority = (event) =>
  event.senderLogin === event.associationSubject
    ? associationAuthority(event)
    : labelAuthority(event);

const authorizationFailure = (event) =>
  event.senderType !== "User" || event.senderLogin.endsWith("[bot]")
    ? `${event.senderLogin} is not a human account`
    : senderAuthority(event);

const readEvent = (environment) => ({
  action: text(environment.EVENT_ACTION),
  associationSubject: text(environment.EVENT_ASSOCIATION_SUBJECT),
  authorAssociation: text(environment.EVENT_AUTHOR_ASSOCIATION),
  commentBody: text(environment.EVENT_COMMENT_BODY),
  eventName: text(environment.EVENT_NAME),
  isPullRequest: environment.EVENT_IS_PULL_REQUEST === "true",
  labelName: text(environment.EVENT_LABEL),
  labels: environment.EVENT_LABELS ? JSON.parse(environment.EVENT_LABELS) : [],
  senderLogin: text(environment.EVENT_SENDER),
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

  if (labels.includes(APPROVED_LABEL)) {
    return skip(
      "the proposal is approved; an ordinary comment restarts nothing"
    );
  }

  return { approval: "none", reason: "discovery continues", role: "planner" };
};

const routeIssueEdited = ({ labels }) =>
  labels.includes(APPROVED_LABEL)
    ? {
        approval: "clear",
        reason: "the approved proposal was edited and needs approving again",
        role: ""
      }
    : skip("editing an unapproved issue changes nothing");

const routeIssueLabeled = ({ labelName, labels }) => {
  if (labelName !== APPROVED_LABEL) {
    return skip(`the ${labelName} label starts nothing`);
  }

  if (!labels.includes(READY_LABEL)) {
    throw new Error(
      `Approved without the ${READY_LABEL} label. The planner applies ` +
        `${READY_LABEL} once no material decisions remain; approving before ` +
        `then approves a proposal that is still moving.`
    );
  }

  return {
    approval: "record",
    reason: "an owner approved the proposal in the issue body",
    role: "implementer"
  };
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

/**
 * The approval state matters only to the implementer, so a decision that
 * carries no role — an edit that invalidates an approval — is gated on the
 * implementer being enabled.
 */
export function decide(environment) {
  const decision = resolveRoute(readEvent(environment));
  const enabled = resolveEnabledRoles(environment.AI_ROLES);
  const gate = decision.role === "" ? "implementer" : decision.role;

  return enabled.has(gate) ? decision : skip(`${gate} is not in AI_ROLES`);
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

/**
 * Resolves the model and effort a role runs with. The workflow's own defaults
 * are the fallbacks, so an enrolled repository that sets no variables gets
 * whatever shipped with the version of the workflow it pinned.
 */
export function settingsFor(role, environment) {
  if (role === "") {
    return { effort: "", model: "" };
  }

  const perRole = {
    implementer: {
      defaultModel: environment.AI_DEFAULT_IMPLEMENTER_MODEL,
      effort: environment.AI_IMPLEMENTER_EFFORT,
      model: environment.AI_IMPLEMENTER_MODEL
    },
    planner: {
      defaultModel: environment.AI_DEFAULT_PLANNER_MODEL,
      effort: environment.AI_PLANNER_EFFORT,
      model: environment.AI_PLANNER_MODEL
    }
  };
  const chosen = role === "planner" ? perRole.planner : perRole.implementer;

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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
