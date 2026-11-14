import { Db } from "mongodb";
import { randomUUID } from "crypto";
import type { AuditEventDoc, AuditEventType } from "../types.js";
import { COLLECTIONS } from "./schemas.js";

export async function appendAuditEvent(
  db: Db,
  event: Omit<AuditEventDoc, "_id" | "ts"> & { _id?: string; ts?: Date },
): Promise<AuditEventDoc> {
  const doc: AuditEventDoc = {
    _id: event._id ?? randomUUID(),
    ts: event.ts ?? new Date(),
    runId: event.runId,
    type: event.type,
    actor: event.actor,
    actionId: event.actionId,
    parentActionId: event.parentActionId,
    payload: event.payload,
  };
  await db.collection<AuditEventDoc>(COLLECTIONS.audit_events).insertOne(
    doc as AuditEventDoc & { _id: string },
  );
  return doc;
}

export async function listRunEvents(db: Db, runId: string): Promise<AuditEventDoc[]> {
  return db
    .collection<AuditEventDoc>(COLLECTIONS.audit_events)
    .find({ runId })
    .sort({ ts: 1 })
    .toArray();
}

export type AuditEventInput = {
  runId: string;
  type: AuditEventType;
  actor: AuditEventDoc["actor"];
  actionId?: string;
  parentActionId?: string | null;
  payload?: Record<string, unknown>;
};