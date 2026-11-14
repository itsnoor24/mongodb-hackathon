import { Db } from "mongodb";
import { randomUUID } from "crypto";
import { appendAuditEvent } from "../db/audit.js";
import { COLLECTIONS } from "../db/schemas.js";
import type {
  AgentDoc,
  PolicyDoc,
  RunDoc,
  ToolCallRequest,
  ExecutionOutcome,
} from "../types.js";
import {
  evaluatePolicy,
  redactArguments,
  resourceKeyForTool,
} from "./policy.js";
import { atlasReadRecord } from "../tools/atlas-read.js";
import {
  githubCreateIssue,
  githubVerifyIssue,
} from "../tools/github-issue.js";

export class GatewayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GatewayError";
  }
}

async function loadContext(
  db: Db,
  runId: string,
  agentId: string,
): Promise<{ run: RunDoc; agent: AgentDoc; policy: PolicyDoc }> {
  const run = await db.collection<RunDoc>(COLLECTIONS.runs).findOne({ _id: runId });
  if (!run) throw new GatewayError(`Run not found: ${runId}`);
  const agent = await db.collection<AgentDoc>(COLLECTIONS.agents).findOne({
    _id: agentId,
  });
  if (!agent?.enabled) throw new GatewayError("Agent disabled or missing");
  const policy = await db
    .collection<PolicyDoc>(COLLECTIONS.policies)
    .findOne({ _id: agent.policyId });
  if (!policy) throw new GatewayError("Policy not found");
  return { run, agent, policy };
}

function validateToolArgs(
  tool: string,
  args: Record<string, unknown>,
): void {
  if (tool === "atlas.read") {
    if (!args.recordId && !args.id) throw new GatewayError("recordId required");
  } else if (tool === "github.issue.create") {
    if (!args.owner || !args.repo || !args.title)
      throw new GatewayError("owner, repo, title required");
  } else {
    throw new GatewayError(`Unknown tool: ${tool}`);
  }
}

export interface GatewayResult {
  actionId: string;
  allowed: boolean;
  executionOutcome: ExecutionOutcome;
  detail: string;
  eventIds: string[];
}

export async function processToolCall(
  db: Db,
  agentId: string,
  req: ToolCallRequest,
): Promise<GatewayResult> {
  validateToolArgs(req.tool, req.arguments);
  const { run, policy } = await loadContext(db, req.runId, agentId);

  const proposedId = randomUUID();
  await appendAuditEvent(db, {
    _id: proposedId,
    runId: req.runId,
    type: "action.proposed",
    actor: { kind: "agent", id: agentId },
    actionId: req.actionId,
    parentActionId: req.parentActionId ?? null,
    payload: {
      tool: req.tool,
      rationale: req.rationale,
      argumentsRedacted: redactArguments(req.arguments),
    },
  });

  const resourceKey = resourceKeyForTool(req.tool, req.arguments);
  const decision = evaluatePolicy(policy, req.tool, resourceKey);
  const decisionId = randomUUID();

  try {
    await appendAuditEvent(db, {
      _id: decisionId,
      runId: req.runId,
      type: "authorization.decided",
      actor: { kind: "gateway", id: "sentinel-gateway" },
      actionId: req.actionId,
      parentActionId: req.parentActionId ?? null,
      payload: {
        outcome: decision.allowed ? "allow" : "deny",
        policyId: decision.policyId,
        policyName: policy.name,
        policyVersion: decision.policyVersion,
        matchedRule: decision.matchedRule,
        reason: decision.reason,
        resourceKey: decision.resourceKey,
        decisionInputRedacted: redactArguments(req.arguments),
      },
    });
  } catch (e) {
    throw new GatewayError("Failed to persist authorization decision — call aborted");
  }

  if (!decision.allowed) {
    await appendAuditEvent(db, {
      runId: req.runId,
      type: "action.completed",
      actor: { kind: "gateway", id: "sentinel-gateway" },
      actionId: req.actionId,
      parentActionId: req.parentActionId ?? null,
      payload: {
        executionOutcome: "never_dispatched" as ExecutionOutcome,
        policyDecision: "deny",
        detail: decision.reason,
      },
    });
    return {
      actionId: req.actionId,
      allowed: false,
      executionOutcome: "never_dispatched",
      detail: decision.reason,
      eventIds: [proposedId, decisionId],
    };
  }

  const freshRun = await db.collection<RunDoc>(COLLECTIONS.runs).findOne({
    _id: req.runId,
  });
  if (freshRun?.status === "paused") {
    const reason = "Run is paused — dispatch blocked at boundary";
    await appendAuditEvent(db, {
      runId: req.runId,
      type: "action.completed",
      actor: { kind: "gateway", id: "sentinel-gateway" },
      actionId: req.actionId,
      parentActionId: req.parentActionId ?? null,
      payload: {
        executionOutcome: "never_dispatched" as ExecutionOutcome,
        policyDecision: "allow",
        detail: reason,
        blockedReason: "run_paused",
      },
    });
    return {
      actionId: req.actionId,
      allowed: false,
      executionOutcome: "never_dispatched",
      detail: reason,
      eventIds: [proposedId, decisionId],
    };
  }

  const dispatchId = randomUUID();
  await appendAuditEvent(db, {
    _id: dispatchId,
    runId: req.runId,
    type: "action.dispatched",
    actor: { kind: "gateway", id: "sentinel-gateway" },
    actionId: req.actionId,
    parentActionId: req.parentActionId ?? null,
    payload: { tool: req.tool },
  });

  let executionOutcome: ExecutionOutcome = "failed";
  let detail = "";

  try {
    if (req.tool === "atlas.read") {
      const recordId = String(req.arguments.recordId ?? req.arguments.id);
      const record = await atlasReadRecord(db, recordId);
      executionOutcome = "verified";
      detail = `Read record ${record._id}`;
      await appendAuditEvent(db, {
        runId: req.runId,
        type: "action.completed",
        actor: { kind: "gateway", id: "sentinel-gateway" },
        actionId: req.actionId,
        parentActionId: req.parentActionId ?? null,
        payload: {
          executionOutcome,
          policyDecision: "allow",
          detail,
          resultSummary: {
            title: record.title,
            ...(record.plantedInstruction
              ? { plantedInstruction: record.plantedInstruction }
              : {}),
          },
        },
      });
    } else if (req.tool === "github.issue.create") {
      const owner = String(req.arguments.owner);
      const repo = String(req.arguments.repo);
      const title = String(req.arguments.title);
      const body = String(req.arguments.body ?? "");
      const created = await githubCreateIssue({ owner, repo, title, body });
      const verified = await githubVerifyIssue(owner, repo, created.issueNumber);
      executionOutcome = verified ? "verified" : "outcome_unknown";
      detail = verified
        ? `Issue #${created.issueNumber} verified at ${created.url}`
        : `Issue created but read-back uncertain`;
      await appendAuditEvent(db, {
        runId: req.runId,
        type: "action.completed",
        actor: { kind: "gateway", id: "sentinel-gateway" },
        actionId: req.actionId,
        parentActionId: req.parentActionId ?? null,
        payload: {
          executionOutcome,
          policyDecision: "allow",
          detail,
          issueNumber: created.issueNumber,
          url: created.url,
        },
      });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    executionOutcome = "failed";
    detail = msg;
    await appendAuditEvent(db, {
      runId: req.runId,
      type: "action.completed",
      actor: { kind: "gateway", id: "sentinel-gateway" },
      actionId: req.actionId,
      parentActionId: req.parentActionId ?? null,
      payload: {
        executionOutcome,
        policyDecision: "allow",
        detail,
      },
    });
  }

  return {
    actionId: req.actionId,
    allowed: true,
    executionOutcome,
    detail,
    eventIds: [proposedId, decisionId, dispatchId],
  };
}