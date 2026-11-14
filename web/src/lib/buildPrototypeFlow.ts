import type { AuditEvent } from "../types";

export interface FlowCard {
  actionId: string;
  title: string;
  meta: string;
  variant: "neutral" | "allow" | "deny" | "queued";
}

export interface PrototypeFlow {
  read: FlowCard | null;
  privateWrite: FlowCard | null;
  publicDeny: FlowCard | null;
  queuedFollowUp: FlowCard | null;
  denialActionId: string | null;
  denialSubtitle: string;
}

function proposed(events: AuditEvent[], actionId: string) {
  return events.find(
    (e) => e.type === "action.proposed" && e.actionId === actionId,
  );
}

function auth(events: AuditEvent[], actionId: string) {
  return events.find(
    (e) => e.type === "authorization.decided" && e.actionId === actionId,
  );
}

function completed(events: AuditEvent[], actionId: string) {
  return events.find(
    (e) => e.type === "action.completed" && e.actionId === actionId,
  );
}

function githubActions(events: AuditEvent[]) {
  return events
    .filter((e) => e.type === "action.proposed")
    .filter((e) => e.payload?.tool === "github.issue.create")
    .map((e) => e.actionId!)
    .filter(Boolean);
}

export function buildPrototypeFlow(events: AuditEvent[]): PrototypeFlow {
  const readProposal = events.find(
    (e) =>
      e.type === "action.proposed" && e.payload?.tool === "atlas.read",
  );
  const readId = readProposal?.actionId;
  const recordId =
    (readProposal?.payload?.argumentsRedacted as { recordId?: string })
      ?.recordId ?? "incident-7842";
  const displayRec = recordId.replace(/^incident-/, "REC-");

  const read: FlowCard | null = readId
    ? {
        actionId: readId,
        title: "Read record",
        meta: `Atlas · ${displayRec}`,
        variant: "neutral",
      }
    : null;

  const ghIds = githubActions(events);
  let publicDeny: FlowCard | null = null;
  let privateWrite: FlowCard | null = null;
  let denialActionId: string | null = null;

  for (const id of ghIds) {
    const p = proposed(events, id);
    const a = auth(events, id);
    const c = completed(events, id);
    const args = p?.payload?.argumentsRedacted as
      | { owner?: string; repo?: string }
      | undefined;
    const denied = a?.payload?.outcome === "deny";

    if (denied) {
      denialActionId = id;
      publicDeny = {
        actionId: id,
        title: "Block public write",
        meta: "× Never dispatched",
        variant: "deny",
      };
    } else if (a?.payload?.outcome === "allow") {
      const issueNum = c?.payload?.issueNumber as number | undefined;
      const verified = c?.payload?.executionOutcome === "verified";
      privateWrite = {
        actionId: id,
        title: "Create private issue",
        meta: verified && issueNum
          ? `✓ Verified · GitHub #${issueNum}`
          : c?.payload?.executionOutcome === "failed"
            ? "Failed · GitHub"
            : "Awaiting verification · GitHub",
        variant: verified ? "allow" : "neutral",
      };
    }
  }

  let queuedMeta = "Queued · GitHub";
  if (privateWrite) {
    const m = privateWrite.meta.match(/#(\d+)/);
    if (m) queuedMeta = `Queued · GitHub #${m[1]}`;
  }

  const queuedFollowUp: FlowCard = {
    actionId: privateWrite
      ? `${privateWrite.actionId}-queued`
      : "queued-placeholder",
    title: "Update issue label",
    meta: queuedMeta,
    variant: "queued",
  };

  return {
    read,
    privateWrite,
    publicDeny,
    queuedFollowUp,
    denialActionId,
    denialSubtitle: "Public repository outside the agent's scope.",
  };
}

export function formatRunNumber(runId: string): string {
  if (runId === "demo-run-001") return "#1042";
  const digits = runId.replace(/\D/g, "");
  return digits ? `#${digits.padStart(4, "0").slice(-4)}` : "#1042";
}

export function formatAgentLabel(agentId: string): string {
  if (agentId === "demo-agent-001" || agentId.startsWith("demo-agent")) {
    return "WORKER-07";
  }
  const slug = agentId.replace(/^demo-agent-/, "").replace(/\D/g, "");
  const num = slug || "07";
  return `WORKER-${num.padStart(2, "0")}`;
}
