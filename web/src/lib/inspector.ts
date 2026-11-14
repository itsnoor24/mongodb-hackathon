import type { AuditEvent, RunDoc } from "../types";

export interface InspectorModel {
  actionCode: string;
  headline: string;
  functionCall: string;
  actor: string;
  initiator: string;
  authorization: string;
  authorizationDenied: boolean;
  rule: string;
  ruleDetail: string;
  context: string;
  execution: string;
  traceCompact: string;
  trace: { ts: string; label: string }[];
}

function shortActionCode(actionId: string | null): string {
  if (!actionId) return "—";
  const n = actionId.replace(/\D/g, "").slice(-3);
  return `ACT-${(n || "002").padStart(3, "0")}`;
}

function headlineFor(events: AuditEvent[], actionId: string): string {
  const proposed = events.find(
    (e) => e.type === "action.proposed" && e.actionId === actionId,
  );
  const tool = proposed?.payload?.tool as string | undefined;
  const args = proposed?.payload?.argumentsRedacted as
    | { owner?: string; repo?: string }
    | undefined;
  const auth = events.find(
    (e) => e.type === "authorization.decided" && e.actionId === actionId,
  );
  const denied = auth?.payload?.outcome === "deny";

  if (tool === "atlas.read") return "Read record";
  if (tool === "github.issue.create") {
    if (denied) return "Create public issue";
    return "Create private issue";
  }
  if (denied) return "Block public write";
  return "Agent action";
}

function functionCallFor(events: AuditEvent[], actionId: string): string {
  const proposed = events.find(
    (e) => e.type === "action.proposed" && e.actionId === actionId,
  );
  const tool = proposed?.payload?.tool as string | undefined;
  const args = proposed?.payload?.argumentsRedacted as Record<string, unknown> | undefined;
  if (tool === "atlas.read") {
    const id = args?.recordId ?? args?.id ?? "REC-204";
    return `atlas.read · ${id}`;
  }
  if (tool === "github.issue.create") {
    const owner = args?.owner ?? "demo-org";
    const repo = args?.repo ?? "public-workspace";
    return `github.create_issue · ${owner}/${repo}`;
  }
  return tool ?? "—";
}

export function buildInspector(
  run: RunDoc | null,
  events: AuditEvent[],
  actionId: string | null,
): InspectorModel {
  const related = actionId
    ? events.filter((e) => e.actionId === actionId)
    : events;

  const proposed = related.find((e) => e.type === "action.proposed");
  const auth = related.find((e) => e.type === "authorization.decided");
  const completed = related.find((e) => e.type === "action.completed");

  const outcome = auth?.payload?.outcome as string | undefined;
  const policyId = auth?.payload?.policyId as string | undefined;
  const policyVersion = auth?.payload?.policyVersion as number | undefined;
  const rule = auth?.payload?.matchedRule as {
    resourcePattern?: string;
    effect?: string;
  } | null;
  const reason = auth?.payload?.reason as string | undefined;
  const exec = completed?.payload?.executionOutcome as string | undefined;
  const detail = completed?.payload?.detail as string | undefined;
  const blocked = completed?.payload?.blockedReason as string | undefined;

  const denialDenied = outcome === "deny";

  const policyName = auth?.payload?.policyName as string | undefined;
  const policyLabel = `${policyName ?? policyId ?? "policy"} v${policyVersion ?? 1}`;

  const ruleDetail = rule?.resourcePattern
    ? `${rule.effect === "deny" ? "Deny" : "Allow"} ${rule.resourcePattern}.`
    : reason ?? "Default deny when no rule matches.";

  const readEvent = events.find(
    (e) => e.type === "action.proposed" && e.payload?.tool === "atlas.read",
  );
  const recordId = (
    readEvent?.payload?.argumentsRedacted as { recordId?: string } | undefined
  )?.recordId;
  const readCompleted = events.find(
    (e) => e.type === "action.completed" && e.actionId && e.actionId === readEvent?.actionId,
  );
  const planted = (
    readCompleted?.payload?.resultSummary as { plantedInstruction?: string } | undefined
  )?.plantedInstruction;
  const context =
    proposed?.payload?.tool === "github.issue.create"
      ? planted && recordId
        ? `Source record ${recordId}: "${planted}"`
        : String(proposed?.payload?.rationale ?? "—")
      : [proposed?.payload?.tool, proposed?.payload?.rationale]
          .filter(Boolean)
          .join(" — ") || "—";

  const traceSteps = related
    .filter((e) =>
      ["action.proposed", "authorization.decided", "action.completed"].includes(
        e.type,
      ),
    )
    .map((e) => {
      if (e.type === "action.proposed") return "Request";
      if (e.type === "authorization.decided") {
        return e.payload?.outcome === "deny" ? "Deny" : "Allow";
      }
      if (e.type === "action.completed") return "Complete";
      return e.type;
    });

  const firstTs = related[0]?.ts;
  const traceCompact =
    firstTs && traceSteps.length
      ? `${new Date(firstTs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })} ${traceSteps.join(" → ")}${denialDenied ? " → Alert" : ""}`
      : "—";

  return {
    actionCode: shortActionCode(actionId),
    headline: actionId ? headlineFor(events, actionId) : "Select an action",
    functionCall: actionId ? functionCallFor(events, actionId) : "—",
    actor: proposed?.actor?.id ?? "—",
    initiator: run?.initiator ?? "—",
    authorization: denialDenied
      ? "Denied by policy"
      : outcome === "allow"
        ? "Allowed by policy"
        : "—",
    authorizationDenied: denialDenied,
    rule: policyLabel,
    ruleDetail,
    context,
    execution: formatExec(exec, detail, blocked, denialDenied),
    traceCompact,
    trace: related.map((e) => ({
      ts: new Date(e.ts).toLocaleTimeString(),
      label: eventLabel(e),
    })),
  };
}

function formatExec(
  exec?: string,
  detail?: string,
  blocked?: string,
  denied?: boolean,
): string {
  if (denied && exec === "never_dispatched") {
    return "Never dispatched · No GitHub request sent";
  }
  const base =
    exec === "never_dispatched"
      ? "Never dispatched"
      : exec === "verified"
        ? "Verified"
        : exec === "outcome_unknown"
          ? "Outcome unknown"
          : exec === "failed"
            ? "Failed"
            : exec ?? "—";
  const parts = [base];
  if (blocked) parts.push(`(${blocked})`);
  if (detail && !denied) parts.push(detail);
  return parts.join(" · ");
}

function eventLabel(e: AuditEvent): string {
  switch (e.type) {
    case "action.proposed":
      return `Proposed · ${e.payload?.tool ?? "action"}`;
    case "authorization.decided":
      return `Policy · ${e.payload?.outcome}`;
    case "action.dispatched":
      return "Dispatched";
    case "action.completed":
      return `Completed · ${e.payload?.executionOutcome}`;
    default:
      return e.type;
  }
}