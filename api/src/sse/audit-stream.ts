import { Response } from "express";
import { ChangeStreamDocument } from "mongodb";
import { getDb } from "../db/client.js";
import { COLLECTIONS } from "../db/schemas.js";
import type { AuditEventDoc } from "../types.js";

const clients = new Set<Response>();
let watcherStarted = false;

function writeSse(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export function registerSseClient(res: Response, runId: string): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  writeSse(res, "hello", { runId });

  clients.add(res);
  void startWatcher();

  res.on("close", () => {
    clients.delete(res);
  });
}

async function startWatcher(): Promise<void> {
  if (watcherStarted) return;
  watcherStarted = true;
  const db = await getDb();
  const stream = db.collection(COLLECTIONS.audit_events).watch([], {
    fullDocument: "updateLookup",
  });

  stream.on("change", (change: ChangeStreamDocument<AuditEventDoc>) => {
    if (change.operationType !== "insert" && change.operationType !== "update") {
      return;
    }
    const doc =
      "fullDocument" in change && change.fullDocument
        ? change.fullDocument
        : null;
    if (!doc) return;
    for (const client of clients) {
      writeSse(client, "audit_event", doc);
    }
  });

  stream.on("error", (err) => {
    console.error("audit_events change stream error", err);
    for (const client of clients) {
      writeSse(client, "error", { message: err.message });
    }
  });
}