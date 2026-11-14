import type { AuditEvent, TreeNode } from "../types";

function labelForAction(events: AuditEvent[], actionId: string): string {
  const proposed = events.find(
    (e) => e.type === "action.proposed" && e.actionId === actionId,
  );
  const tool = proposed?.payload?.tool as string | undefined;
  if (tool === "atlas.read") return "Read Atlas record";
  if (tool === "github.issue.create") return "Create GitHub issue";
  return tool ?? actionId;
}

export function buildDecisionTree(events: AuditEvent[]): TreeNode {
  const proposals = events.filter((e) => e.type === "action.proposed");
  const root: TreeNode = {
    id: "root",
    kind: "root",
    label: "Agent run",
    children: [],
  };

  for (const p of proposals) {
    const actionId = p.actionId!;
    const auth = events.find(
      (e) => e.type === "authorization.decided" && e.actionId === actionId,
    );
    const completed = events.find(
      (e) => e.type === "action.completed" && e.actionId === actionId,
    );
    const allowed = auth?.payload?.outcome === "allow";
    const denied = auth?.payload?.outcome === "deny";
    const outcome = completed?.payload?.executionOutcome as string | undefined;

    const actionNode: TreeNode = {
      id: `action-${actionId}`,
      kind: "action",
      label: labelForAction(events, actionId),
      actionId,
      children: [],
    };

    const decisionNode: TreeNode = {
      id: `decision-${actionId}`,
      kind: "decision",
      label: "Policy check",
      actionId,
      children: [],
    };

    const allowBranch: TreeNode = {
      id: `allow-${actionId}`,
      kind: "branch",
      label: "Allow",
      actionId,
      children: [],
    };

    const denyBranch: TreeNode = {
      id: `deny-${actionId}`,
      kind: "branch",
      label: "Deny",
      actionId,
      denied: true,
      children: [],
    };

    if (allowed) {
      allowBranch.children.push({
        id: `outcome-${actionId}`,
        kind: "outcome",
        label: formatOutcome(outcome),
        actionId,
        children: [],
      });
      decisionNode.children = [allowBranch, denyBranch];
    } else if (denied) {
      denyBranch.children.push({
        id: `outcome-${actionId}`,
        kind: "outcome",
        label: "Never dispatched",
        actionId,
        denied: true,
        children: [],
      });
      decisionNode.children = [denyBranch, allowBranch];
    } else {
      decisionNode.children = [allowBranch, denyBranch];
    }

    actionNode.children.push(decisionNode);
    root.children.push(actionNode);
  }

  return root;
}

function formatOutcome(outcome?: string): string {
  switch (outcome) {
    case "verified":
      return "Verified";
    case "never_dispatched":
      return "Never dispatched";
    case "outcome_unknown":
      return "Outcome unknown";
    case "failed":
      return "Failed";
    default:
      return outcome ?? "Pending";
  }
}

export function findDenialActionId(events: AuditEvent[]): string | null {
  for (const e of events) {
    if (e.type === "authorization.decided" && e.payload?.outcome === "deny") {
      return e.actionId ?? null;
    }
  }
  return null;
}