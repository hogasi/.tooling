const MARKER = "<!-- hogasi-ai delivery-plan ";
const MAX_BODY = 60_000;

export function appendDeliveryPlan(proposal, deliverables = []) {
  validateDeliverables(deliverables);
  if (deliverables.length === 0) {
    return proposal;
  }
  const sections = deliverables.map(
    (child) =>
      `### ${child.key}: ${child.title}\n\n${child.body}\n\nPrerequisites: ${child.dependsOn.length > 0 ? child.dependsOn.join(", ") : "none"}.`
  );
  const body = `${proposal}\n\n## Child deliverables\n\n${sections.join("\n\n")}\n\n${MARKER}${JSON.stringify(deliverables)} -->`;
  if (body.length > MAX_BODY) {
    throw new Error(
      "The complete delivery proposal exceeds the issue comment limit"
    );
  }
  return body;
}

export function readDeliveryPlan(proposal) {
  const line = proposal.body
    .split("\n")
    .find((value) => value.startsWith(MARKER));
  if (!line) {
    return [];
  }
  if (!line.endsWith(" -->")) {
    throw new Error("Malformed delivery plan");
  }
  const children = JSON.parse(line.slice(MARKER.length, -4));
  validateDeliverables(children);
  return children;
}

function validateChild(child) {
  if (!child || !/^[a-z][a-z0-9-]{0,39}$/.test(child.key)) {
    throw new Error("Invalid deliverable key");
  }
  validateText(child.title);
  validateText(child.body);
  if (child.title.length > 256 || !Array.isArray(child.dependsOn)) {
    throw new Error("Invalid deliverable title or prerequisites");
  }
  if (new Set(child.dependsOn).size !== child.dependsOn.length) {
    throw new Error("Duplicate deliverable prerequisite");
  }
}

function validateDeliverables(children) {
  if (!Array.isArray(children)) {
    throw new TypeError("Deliverables must be an array");
  }
  const keys = new Set();
  for (const child of children) {
    validateChild(child);
    if (keys.has(child.key)) {
      throw new Error("Duplicate deliverable key");
    }
    keys.add(child.key);
  }
  validateDependencies(children, keys);
}

function validateDependencies(children, keys) {
  const remaining = new Map(
    children.map((child) => [child.key, child.dependsOn])
  );
  if (children.some((child) => child.dependsOn.some((key) => !keys.has(key)))) {
    throw new Error("Unknown deliverable prerequisite");
  }
  while (remaining.size > 0) {
    const ready = [...remaining].filter(([, dependencies]) =>
      dependencies.every((key) => !remaining.has(key))
    );
    if (ready.length === 0) {
      throw new Error("Deliverable dependency cycle");
    }
    for (const [key] of ready) {
      remaining.delete(key);
    }
  }
}

function validateText(text) {
  if (
    typeof text !== "string" ||
    !text.trim() ||
    text.includes("<!-- hogasi-")
  ) {
    throw new TypeError("Invalid deliverable text");
  }
}
