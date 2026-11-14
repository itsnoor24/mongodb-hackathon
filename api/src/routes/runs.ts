import { Router } from "express";
import { getDb } from "../db/client.js";
import { listRunEvents } from "../db/audit.js";
import { COLLECTIONS } from "../db/schemas.js";
import type { RunDoc, AuditEventDoc } from "../types.js";
import { config } from "../config.js";

export const runsRouter = Router();

export interface RunView {
  run: RunDoc | null;
  events: AuditEventDoc[];
}

runsRouter.get("/demo", async (_req, res) => {
  try {
    const db = await getDb();
    const run = await db
      .collection<RunDoc>(COLLECTIONS.runs)
      .findOne({ _id: config.demoRunId });
    const events = await listRunEvents(db, config.demoRunId);
    res.json({ run, events });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    res.status(500).json({ error: msg });
  }
});

runsRouter.get("/:runId", async (req, res) => {
  try {
    const db = await getDb();
    const run = await db
      .collection<RunDoc>(COLLECTIONS.runs)
      .findOne({ _id: req.params.runId });
    const events = await listRunEvents(db, req.params.runId);
    res.json({ run, events });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    res.status(500).json({ error: msg });
  }
});