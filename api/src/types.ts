export const AUDIT_EVENT_TYPES = [
  "run.started",
  "run.paused",
  "run.resumed",
  "action.proposed",
  "authorization.decided",
  "action.dispatched",
  "action.completed",
  "reviewer.intervention",
] as const;

export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

export type RunStatus = "running" | "paused" | "completed" | "failed";

export type AuthorizationOutcome = "allow" | "deny";

export type ExecutionOutcome =
  | "never_dispatched"
  | "verified"
  | "failed"
  | "outcome_unknown";

export interface AgentDoc {
  _id: string;
  name: string;
  enabled: boolean;
  policyId: string;
  credentialHash: string;
}

export interface PolicyRule {
  tool: string;
  resourcePattern: string;
  effect: "allow" | "deny";
  priority?: number;
}

export interface PolicyDoc {
  _id: string;
  version: number;
  name: string;
  rules: PolicyRule[];
}

export interface RunDoc {
  _id: string;
  agentId: string;
  initiator: string;
  status: RunStatus;
  replayMode?: boolean;
  pausedBy?: string;
  pausedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuditEventDoc {
  _id: string;
  runId: string;
  ts: Date;
  type: AuditEventType;
  actor: { kind: "agent" | "reviewer" | "system" | "gateway"; id: string };
  actionId?: string;
  parentActionId?: string | null;
  payload?: Record<string, unknown>;
}

export interface DemoRecordDoc {
  _id: string;
  title: string;
  summary: string;
  plantedInstruction?: string;
  metadata?: Record<string, unknown>;
}

export interface ToolCallRequest {
  runId: string;
  actionId: string;
  parentActionId?: string | null;
  tool: string;
  arguments: Record<string, unknown>;
  rationale?: string;
}