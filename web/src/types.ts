export type RunStatus = "running" | "paused" | "completed" | "failed";

export interface RunDoc {
  _id: string;
  agentId: string;
  initiator: string;
  status: RunStatus;
  replayMode?: boolean;
  pausedBy?: string;
  pausedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuditEvent {
  _id: string;
  runId: string;
  ts: string;
  type: string;
  actor: { kind: string; id: string };
  actionId?: string;
  parentActionId?: string | null;
  payload?: Record<string, unknown>;
}

export type TreeNodeKind =
  | "root"
  | "action"
  | "decision"
  | "branch"
  | "outcome";

export interface TreeNode {
  id: string;
  kind: TreeNodeKind;
  label: string;
  sublabel?: string;
  actionId?: string;
  denied?: boolean;
  selected?: boolean;
  children: TreeNode[];
}