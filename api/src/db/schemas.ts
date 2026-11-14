import { AUDIT_EVENT_TYPES } from "../types.js";

const eventTypeEnum = { enum: [...AUDIT_EVENT_TYPES] };

export const agentsValidator = {
  $jsonSchema: {
    bsonType: "object",
    required: ["_id", "name", "enabled", "policyId", "credentialHash"],
    properties: {
      _id: { bsonType: "string" },
      name: { bsonType: "string" },
      enabled: { bsonType: "bool" },
      policyId: { bsonType: "string" },
      credentialHash: { bsonType: "string" },
    },
  },
};

export const policiesValidator = {
  $jsonSchema: {
    bsonType: "object",
    required: ["_id", "version", "name", "rules"],
    properties: {
      _id: { bsonType: "string" },
      version: { bsonType: "int" },
      name: { bsonType: "string" },
      rules: {
        bsonType: "array",
        items: {
          bsonType: "object",
          required: ["tool", "resourcePattern", "effect"],
          properties: {
            tool: { bsonType: "string" },
            resourcePattern: { bsonType: "string" },
            effect: { enum: ["allow", "deny"] },
            priority: { bsonType: "int" },
          },
        },
      },
    },
  },
};

export const runsValidator = {
  $jsonSchema: {
    bsonType: "object",
    required: ["_id", "agentId", "initiator", "status", "createdAt", "updatedAt"],
    properties: {
      _id: { bsonType: "string" },
      agentId: { bsonType: "string" },
      initiator: { bsonType: "string" },
      status: { enum: ["running", "paused", "completed", "failed"] },
      replayMode: { bsonType: "bool" },
      pausedBy: { bsonType: "string" },
      pausedAt: { bsonType: "date" },
      createdAt: { bsonType: "date" },
      updatedAt: { bsonType: "date" },
    },
  },
};

export const auditEventsValidator = {
  $jsonSchema: {
    bsonType: "object",
    required: ["_id", "runId", "ts", "type", "actor"],
    properties: {
      _id: { bsonType: "string" },
      runId: { bsonType: "string" },
      ts: { bsonType: "date" },
      type: eventTypeEnum,
      actor: {
        bsonType: "object",
        required: ["kind", "id"],
        properties: {
          kind: { enum: ["agent", "reviewer", "system", "gateway"] },
          id: { bsonType: "string" },
        },
      },
      actionId: { bsonType: "string" },
      parentActionId: { bsonType: ["string", "null"] },
      payload: { bsonType: "object" },
    },
  },
};

export const demoRecordsValidator = {
  $jsonSchema: {
    bsonType: "object",
    required: ["_id", "title", "summary"],
    properties: {
      _id: { bsonType: "string" },
      title: { bsonType: "string" },
      summary: { bsonType: "string" },
      plantedInstruction: { bsonType: "string" },
      metadata: { bsonType: "object" },
    },
  },
};

export const COLLECTIONS = {
  agents: "agents",
  policies: "policies",
  runs: "runs",
  audit_events: "audit_events",
  demo_records: "demo_records",
} as const;