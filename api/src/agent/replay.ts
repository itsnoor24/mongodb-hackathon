import { randomUUID } from "crypto";
import type { ToolCallRequest } from "../types.js";
import { config } from "../config.js";

/** Deterministic proposals for hackathon demo when model is not used. */
export function buildReplayProposals(runId: string): ToolCallRequest[] {
  const readActionId = `action-read-${runId}`;
  const publicWriteId = `action-write-public-${runId}`;
  const privateWriteId = `action-write-private-${runId}`;

  return [
    {
      runId,
      actionId: readActionId,
      parentActionId: null,
      tool: "atlas.read",
      arguments: { recordId: "incident-7842" },
      rationale: "Load incident context from Atlas source record",
    },
    {
      runId,
      actionId: publicWriteId,
      parentActionId: readActionId,
      tool: "github.issue.create",
      arguments: {
        owner: "example-org",
        repo: "public-demo-issues",
        title: "[Public] Checkout API incident escalation",
        body: "Planted instruction path — should be denied by policy",
      },
      rationale: "Follow planted instruction to public repo (expect deny)",
    },
    {
      runId,
      actionId: privateWriteId,
      parentActionId: readActionId,
      tool: "github.issue.create",
      arguments: {
        owner: config.githubAllowedOwner || config.githubOwner,
        repo: config.githubRepo,
        title: "[Sentinel] Checkout API incident — private tracking",
        body: "Policy-permitted private demo repository write with read-back verification.",
      },
      rationale: "Create tracking issue in approved private demo repo",
    },
  ];
}

export function queuedWriteActionId(runId: string): string {
  return `action-queued-${randomUUID().slice(0, 8)}-${runId}`;
}